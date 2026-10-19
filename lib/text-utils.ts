/**
 * 브라우저와 서버가 함께 쓰는 순수 함수 모음. Node 전용 모듈을 import 하지 않는다.
 */

export const TEXT_EXTENSIONS = ["txt", "md", "markdown", "srt", "vtt", "csv", "log", "text"];
export const DOC_EXTENSIONS = ["docx", "pdf"];
export const AUDIO_EXTENSIONS = ["mp3", "m4a", "wav", "mp4", "aac", "ogg", "flac", "webm", "mpeg", "mpga"];

export const ACCEPT_ATTR = [...TEXT_EXTENSIONS, ...DOC_EXTENSIONS, ...AUDIO_EXTENSIONS]
  .map((ext) => `.${ext}`)
  .join(",");

/** Vercel 함수 요청 본문 상한(4.5MB)보다 조금 작게 잡은 값. */
export const MAX_REQUEST_BYTES = 4_400_000;
/** 브라우저에서 읽을 음성 파일 상한. */
export const MAX_AUDIO_BYTES = 500 * 1024 * 1024;
/** 회의록 생성에 넘길 녹취 길이 상한(글자 수). */
export const MAX_TRANSCRIPT_CHARS = 600_000;

export type FileKind = "text" | "doc" | "audio" | "unsupported";

export function extensionOf(filename: string): string {
  const idx = filename.lastIndexOf(".");
  return idx === -1 ? "" : filename.slice(idx + 1).toLowerCase();
}

export function classifyFile(filename: string): FileKind {
  const ext = extensionOf(filename);
  if (TEXT_EXTENSIONS.includes(ext)) return "text";
  if (DOC_EXTENSIONS.includes(ext)) return "doc";
  if (AUDIO_EXTENSIONS.includes(ext)) return "audio";
  return "unsupported";
}

/** UTF-8 로 읽고, 깨진 글자가 많으면 EUC-KR(CP949)로 다시 읽는다. */
export function decodeText(bytes: Uint8Array): string {
  let text = new TextDecoder("utf-8").decode(bytes).replace(/^﻿/, "");
  const broken = (text.match(/�/g) ?? []).length;
  if (broken > 0 && broken > text.length / 200) {
    try {
      text = new TextDecoder("euc-kr").decode(bytes);
    } catch {
      // euc-kr 디코더가 없는 환경이면 UTF-8 결과를 그대로 쓴다.
    }
  }
  return text;
}

/** SRT/VTT 자막의 번호 줄과 타임코드 줄을 지운다. */
export function stripSubtitleNoise(text: string): string {
  return text
    .split(/\r?\n/)
    .filter((line) => {
      const t = line.trim();
      if (!t) return false;
      if (t === "WEBVTT") return false;
      if (/^\d+$/.test(t)) return false;
      if (/^\d{1,2}:\d{2}(:\d{2})?[.,]\d{3}\s*-->/.test(t)) return false;
      return true;
    })
    .join("\n");
}

export function normalizeText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** 텍스트 계열 파일의 바이트를 녹취 텍스트로 바꾼다. */
export function textFromBytes(filename: string, bytes: Uint8Array): string {
  let text = decodeText(bytes);
  const ext = extensionOf(filename);
  if (ext === "srt" || ext === "vtt") text = stripSubtitleNoise(text);
  return normalizeText(text);
}

/** 한 줄에 하나 또는 쉼표로 구분된 용어 목록을 정리한다. */
export function parseGlossary(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(/[\n,]/)) {
    const term = part.trim();
    if (!term || term.length > 50 || seen.has(term)) continue;
    seen.add(term);
    out.push(term);
    if (out.length >= 100) break;
  }
  return out;
}

/** 초 단위를 mm:ss 또는 h:mm:ss 로 바꾼다. */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(sec).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
