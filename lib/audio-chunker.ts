/**
 * 브라우저 전용. 긴 음성 파일을 16kHz 모노로 풀어 2분 이내의 WAV 조각으로 자른다.
 * 이렇게 하면 OpenAI 의 25MB 파일 제한과 Vercel 의 4.5MB 요청 본문 제한을 모두 피할 수 있다.
 * (16kHz 모노 16비트 WAV 는 1초에 32KB 이므로 120초 조각은 약 3.84MB 이다.)
 */

export const SAMPLE_RATE = 16_000;

/** 목표 조각 길이. 이 길이 앞뒤 10초 안에서 가장 조용한 지점을 찾아 자른다. */
const TARGET_SEC = 110;
const SEARCH_SEC = 10;
/** 3시간을 넘는 녹음은 메모리 문제로 받지 않는다. */
export const MAX_AUDIO_SECONDS = 3 * 60 * 60;
/** 이 값보다 최대 진폭이 작은 조각은 무음으로 보고 변환을 건너뛴다. */
const SILENCE_PEAK = 0.003;

export interface ChunkSpec {
  index: number;
  start: number; // 샘플 단위
  end: number;
}

export class AudioDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AudioDecodeError";
  }
}

type AudioContextCtor = new (options?: AudioContextOptions) => AudioContext;

function audioContextCtor(): AudioContextCtor {
  const w = window as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor };
  const ctor = w.AudioContext ?? w.webkitAudioContext;
  if (!ctor) throw new AudioDecodeError("이 브라우저는 음성 파일 처리를 지원하지 않습니다. 최신 Chrome이나 Edge를 사용해 주세요.");
  return ctor;
}

async function toMono16k(buffer: AudioBuffer): Promise<Float32Array> {
  if (buffer.sampleRate !== SAMPLE_RATE) {
    const length = Math.ceil(buffer.duration * SAMPLE_RATE);
    const offline = new OfflineAudioContext(1, length, SAMPLE_RATE);
    const source = offline.createBufferSource();
    source.buffer = buffer;
    source.connect(offline.destination);
    source.start();
    const rendered = await offline.startRendering();
    return rendered.getChannelData(0).slice();
  }

  if (buffer.numberOfChannels === 1) return buffer.getChannelData(0).slice();

  const out = new Float32Array(buffer.length);
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
  for (let i = 0; i < out.length; i++) {
    let sum = 0;
    for (const ch of channels) sum += ch[i];
    out[i] = sum / channels.length;
  }
  return out;
}

/** 음성 파일을 16kHz 모노 샘플로 푼다. */
export async function decodeToMono16k(file: File): Promise<Float32Array> {
  const Ctor = audioContextCtor();
  let ctx: AudioContext;
  try {
    ctx = new Ctor({ sampleRate: SAMPLE_RATE });
  } catch {
    ctx = new Ctor();
  }

  try {
    const bytes = await file.arrayBuffer();
    let decoded: AudioBuffer;
    try {
      decoded = await ctx.decodeAudioData(bytes);
    } catch {
      throw new AudioDecodeError(
        "이 파일을 브라우저에서 읽지 못했습니다. 파일이 손상되었거나 지원하지 않는 형식일 수 있습니다. mp3나 m4a로 변환해 다시 시도해 주세요.",
      );
    }
    if (decoded.duration > MAX_AUDIO_SECONDS) {
      throw new AudioDecodeError("녹음이 3시간을 넘습니다. 나누어 올려 주세요.");
    }
    return await toMono16k(decoded);
  } finally {
    void ctx.close();
  }
}

/** 조용한 지점에서 자르도록 조각 경계를 정한다. 조각은 최대 120초이다. */
export function planChunks(samples: Float32Array): ChunkSpec[] {
  const target = TARGET_SEC * SAMPLE_RATE;
  const search = SEARCH_SEC * SAMPLE_RATE;
  const frame = SAMPLE_RATE / 10; // 0.1초
  const specs: ChunkSpec[] = [];

  let start = 0;
  while (start < samples.length) {
    if (samples.length - start <= target + search) {
      specs.push({ index: specs.length, start, end: samples.length });
      break;
    }

    const from = start + target - search;
    const to = start + target + search;
    let bestEnergy = Infinity;
    let cut = start + target;
    for (let p = from; p + frame <= to; p += frame) {
      let energy = 0;
      for (let i = p; i < p + frame; i++) energy += samples[i] * samples[i];
      if (energy < bestEnergy) {
        bestEnergy = energy;
        cut = p + Math.floor(frame / 2);
      }
    }

    specs.push({ index: specs.length, start, end: cut });
    start = cut;
  }
  return specs;
}

export function isSilent(samples: Float32Array, spec: ChunkSpec): boolean {
  for (let i = spec.start; i < spec.end; i++) {
    if (Math.abs(samples[i]) >= SILENCE_PEAK) return false;
  }
  return true;
}

/** 샘플 구간을 16비트 PCM WAV 로 만든다. */
export function encodeWav(samples: Float32Array, spec: ChunkSpec): Blob {
  const length = spec.end - spec.start;
  const buffer = new ArrayBuffer(44 + length * 2);
  const view = new DataView(buffer);

  const writeString = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + length * 2, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true); // fmt 청크 크기
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // 모노
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * 2, true); // 바이트율
  view.setUint16(32, 2, true); // 블록 크기
  view.setUint16(34, 16, true); // 비트 수
  writeString(36, "data");
  view.setUint32(40, length * 2, true);

  for (let i = 0; i < length; i++) {
    const s = Math.max(-1, Math.min(1, samples[spec.start + i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buffer], { type: "audio/wav" });
}
