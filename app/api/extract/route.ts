import { extractTranscript, UnsupportedFileError } from "@/lib/extract-text";
import { guard, jsonError } from "@/lib/guard";
import { MAX_REQUEST_BYTES } from "@/lib/text-utils";

export const runtime = "nodejs";
export const maxDuration = 60;

/** .docx / .pdf 에서 텍스트를 뽑는다. 요청 본문이 4.5MB 를 넘으면 Vercel 이 먼저 거부한다. */
export async function POST(request: Request) {
  const denied = await guard(request, "extract");
  if (denied) return denied;

  let file: FormDataEntryValue | null;
  try {
    file = (await request.formData()).get("file");
  } catch {
    return jsonError("파일을 읽지 못했습니다.", 400);
  }
  if (!(file instanceof File)) return jsonError("파일이 없습니다.", 400);
  if (file.size > MAX_REQUEST_BYTES) {
    return jsonError(`파일이 너무 큽니다. ${(MAX_REQUEST_BYTES / 1_000_000).toFixed(1)}MB 이하로 올려 주세요.`, 413);
  }

  try {
    const text = await extractTranscript(file);
    return Response.json({ text });
  } catch (e) {
    if (e instanceof UnsupportedFileError) return jsonError(e.message, 415);
    return jsonError(e instanceof Error ? e.message : "텍스트를 추출하지 못했습니다.", 422);
  }
}
