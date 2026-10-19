/**
 * OpenAI REST 호출. SDK 없이 fetch 만 쓴다(서버 전용).
 * 상류 오류는 UpstreamError 로 바꿔 화면에 읽을 수 있는 한국어 메시지로 전달한다.
 */

const BASE_URL = "https://api.openai.com/v1";

export class UpstreamError extends Error {
  status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.name = "UpstreamError";
    this.status = status;
  }
}

function apiKey(): string {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new UpstreamError("서버에 OPENAI_API_KEY 가 설정되지 않았습니다.", 500);
  return key;
}

async function errorDetail(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { message?: string } };
    return body?.error?.message ?? "";
  } catch {
    return "";
  }
}

function httpError(res: Response, detail: string, what: string): UpstreamError {
  const suffix = detail ? ` (${detail})` : "";
  if (res.status === 401 || res.status === 403) {
    return new UpstreamError(`OpenAI API 키가 올바르지 않거나 권한이 없습니다.${suffix}`);
  }
  if (res.status === 429) {
    return new UpstreamError(
      `OpenAI 사용량 한도에 도달했습니다. 잠시 뒤 다시 시도하거나 결제·한도 설정을 확인해 주세요.${suffix}`,
      429,
    );
  }
  if (res.status === 400 || res.status === 404) {
    return new UpstreamError(`${what} 요청이 거부되었습니다. 모델 이름이나 입력을 확인해 주세요.${suffix}`);
  }
  return new UpstreamError(`${what} 중 OpenAI 서버 오류가 발생했습니다 (${res.status}).${suffix}`);
}

async function fetchUpstream(url: string, init: RequestInit, what: string, timeoutMs: number): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) {
      throw new UpstreamError(`${what} 시간이 너무 오래 걸려 중단했습니다. 다시 시도해 주세요.`, 504);
    }
    throw new UpstreamError(`${what} 중 OpenAI에 연결하지 못했습니다.`);
  }
}

// ── 음성 → 텍스트 ───────────────────────────────────────────

export function sttModel(): string {
  return process.env.OPENAI_STT_MODEL || "gpt-4o-transcribe";
}

/** 짧은 오디오 조각 하나를 한국어 텍스트로 바꾼다. */
export async function transcribeChunk(audio: Blob, filename: string, glossary: string[]): Promise<string> {
  const model = sttModel();
  const form = new FormData();
  form.append("file", audio, filename);
  form.append("model", model);

  if (model.startsWith("gpt-transcribe")) {
    // 새 모델은 language 대신 languages / keywords 를 쓴다. 배열 전송 형식은 공식 문서에서 확인하지 못했다.
    form.append("languages[]", "ko");
    for (const term of glossary) form.append("keywords[]", term);
  } else {
    form.append("language", "ko");
  }

  if (glossary.length > 0) {
    // 용어 사전은 모든 모델에서 prompt 로도 알려 준다(철자 힌트일 뿐 출력으로 강제되지 않는다).
    form.append("prompt", `회의에서 다음 용어가 나올 수 있습니다: ${glossary.join(", ").slice(0, 600)}`);
  }

  const res = await fetchUpstream(
    `${BASE_URL}/audio/transcriptions`,
    { method: "POST", headers: { Authorization: `Bearer ${apiKey()}` }, body: form },
    "음성 변환",
    55_000,
  );
  if (!res.ok) throw httpError(res, await errorDetail(res), "음성 변환");

  const data = (await res.json()) as { text?: string };
  return (data.text ?? "").trim();
}

// ── 구조화 출력 (회의록 생성) ───────────────────────────────

export function minutesModel(): string {
  return process.env.OPENAI_MINUTES_MODEL || "gpt-6.1-sol";
}

interface StructuredRequest {
  instructions: string;
  input: string;
  schemaName: string;
  schema: Record<string, unknown>;
  maxOutputTokens: number;
}

type ResponsesOutput = {
  status?: string;
  incomplete_details?: { reason?: string } | null;
  output?: Array<{
    type?: string;
    content?: Array<{ type?: string; text?: string; refusal?: string }>;
  }>;
};

/** Responses API 에 JSON 스키마(strict)로 요청하고, 파싱한 JSON 값을 돌려준다. */
export async function createStructuredResponse(req: StructuredRequest): Promise<unknown> {
  const res = await fetchUpstream(
    `${BASE_URL}/responses`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey()}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: minutesModel(),
        instructions: req.instructions,
        input: [{ role: "user", content: req.input }],
        text: {
          format: { type: "json_schema", name: req.schemaName, strict: true, schema: req.schema },
        },
        max_output_tokens: req.maxOutputTokens,
        store: false, // 입력 내용을 OpenAI 쪽에 저장하지 않도록 요청
      }),
    },
    "회의록 생성",
    280_000,
  );
  if (!res.ok) throw httpError(res, await errorDetail(res), "회의록 생성");

  const data = (await res.json()) as ResponsesOutput;

  if (data.status === "incomplete") {
    const reason = data.incomplete_details?.reason ?? "알 수 없음";
    throw new UpstreamError(`회의록 생성이 중간에 끊겼습니다 (${reason}). 녹취가 너무 길면 나누어 올려 주세요.`);
  }

  let text = "";
  for (const item of data.output ?? []) {
    if (item.type !== "message") continue;
    for (const part of item.content ?? []) {
      if (part.type === "refusal") {
        throw new UpstreamError(`모델이 요청을 처리하지 않았습니다: ${part.refusal ?? ""}`, 422);
      }
      if (part.type === "output_text") text += part.text ?? "";
    }
  }
  if (!text) throw new UpstreamError("모델이 빈 응답을 돌려주었습니다. 다시 시도해 주세요.");

  try {
    return JSON.parse(text);
  } catch {
    throw new UpstreamError("모델 응답을 해석하지 못했습니다. 다시 시도해 주세요.");
  }
}
