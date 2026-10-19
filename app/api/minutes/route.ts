import { guard, jsonError } from "@/lib/guard";
import { generateMinutes } from "@/lib/minutes";
import { UpstreamError } from "@/lib/openai";
import { MAX_TRANSCRIPT_CHARS, parseGlossary } from "@/lib/text-utils";

export const runtime = "nodejs";
export const maxDuration = 300;

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export async function POST(request: Request) {
  const denied = await guard(request, "minutes");
  if (denied) return denied;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return jsonError("요청 형식이 올바르지 않습니다.", 400);
  }

  const transcript = asString(body.transcript).trim();
  if (!transcript) return jsonError("녹취 내용이 비어 있습니다.", 400);
  if (transcript.length > MAX_TRANSCRIPT_CHARS) {
    return jsonError(
      `녹취가 너무 깁니다. ${MAX_TRANSCRIPT_CHARS.toLocaleString("ko-KR")}자 이하로 나누어 올려 주세요.`,
      413,
    );
  }

  try {
    const markdown = await generateMinutes({
      transcript,
      title: asString(body.title),
      datetime: asString(body.datetime),
      attendees: asString(body.attendees),
      glossary: parseGlossary(asString(body.glossary)),
    });
    return Response.json({ markdown });
  } catch (e) {
    if (e instanceof UpstreamError) return jsonError(e.message, e.status);
    return jsonError("회의록 생성 중 알 수 없는 오류가 발생했습니다.", 500);
  }
}
