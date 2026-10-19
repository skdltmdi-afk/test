/** 브라우저 전용 fetch 도우미. 서버가 돌려주는 한국어 오류 메시지를 그대로 예외로 올린다. */

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function readResponse<T>(res: Response): Promise<T> {
  const raw = await res.text();
  let data: unknown = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    // JSON 이 아닌 응답(예: 플랫폼의 413 안내 페이지)
  }

  if (!res.ok) {
    const fromServer = (data as { error?: unknown } | null)?.error;
    const message =
      typeof fromServer === "string" && fromServer
        ? fromServer
        : res.status === 413
          ? "보낸 내용이 너무 커서 서버가 받지 못했습니다."
          : `요청이 실패했습니다 (${res.status}).`;
    throw new ApiError(message, res.status);
  }
  return data as T;
}

export async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return readResponse<T>(res);
}

export async function postForm<T>(url: string, form: FormData): Promise<T> {
  const res = await fetch(url, { method: "POST", body: form });
  return readResponse<T>(res);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** 음성 조각 하나를 변환한다. 일시적인 오류는 최대 3번까지 다시 시도한다. */
export async function transcribeChunkWithRetry(audio: Blob, glossary: string): Promise<string> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const form = new FormData();
      form.append("file", audio, "chunk.wav");
      form.append("glossary", glossary);
      const { text } = await postForm<{ text: string }>("/api/transcribe", form);
      return text;
    } catch (e) {
      lastError = e;
      const permanent = e instanceof ApiError && [400, 401, 413, 415, 422].includes(e.status);
      if (permanent) throw e;
      await sleep(2000 * (attempt + 1));
    }
  }
  throw lastError;
}

/** 항목을 동시에 concurrency 개씩 처리한다. 하나라도 실패하면 새 작업을 멈추고 그 오류를 던진다. */
export async function runPool<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let next = 0;
  let failure: { error: unknown } | null = null;

  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (failure === null) {
      const index = next++;
      if (index >= items.length) return;
      try {
        await worker(items[index], index);
      } catch (error) {
        failure = { error };
        return;
      }
    }
  });

  await Promise.all(runners);
  if (failure !== null) throw (failure as { error: unknown }).error;
}
