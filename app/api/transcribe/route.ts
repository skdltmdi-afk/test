import { guard, jsonError } from "@/lib/guard";
import { transcribeChunk, UpstreamError } from "@/lib/openai";
import { transcribeLimit } from "@/lib/rate-limit";
import { MAX_REQUEST_BYTES, parseGlossary } from "@/lib/text-utils";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * 브라우저가 잘라 보낸 짧은 음성 조각(WAV, 약 2분) 하나를 텍스트로 바꾼다.
 * 긴 파일 전체를 한 번에 받지 않으므로 Vercel 의 4.5MB 본문 제한 안에서 동작한다.
 */
export async function POST(request: Request) {
  const denied = await guard(request, "transcribe", transcribeLimit());
  if (denied) return denied;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return jsonError("음성 조각을 읽지 못했습니다.", 400);
  }

  const file = form.get("file");
  if (!(file instanceof File)) return jsonError("음성 파일이 없습니다.", 400);
  if (file.size > MAX_REQUEST_BYTES) return jsonError("음성 조각이 너무 큽니다.", 413);
  if (file.size === 0) return jsonError("음성 조각이 비어 있습니다.", 400);

  const glossaryRaw = form.get("glossary");
  const glossary = typeof glossaryRaw === "string" ? parseGlossary(glossaryRaw) : [];

  try {
    const text = await transcribeChunk(file, "chunk.wav", glossary);
    return Response.json({ text });
  } catch (e) {
    if (e instanceof UpstreamError) return jsonError(e.message, e.status);
    return jsonError("음성 변환 중 알 수 없는 오류가 발생했습니다.", 500);
  }
}
