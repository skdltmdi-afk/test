import { isAuthenticated } from "./auth";
import { checkRate, clientIp, generalLimit } from "./rate-limit";

export function jsonError(message: string, status: number, headers?: Record<string, string>): Response {
  return Response.json({ error: message }, { status, headers });
}

/**
 * 로그인 여부와 요청 횟수를 확인한다. 통과하면 null, 막히면 그대로 돌려줄 응답을 반환한다.
 * 상류 서비스(OpenAI) 오류에는 401 을 쓰지 않는다. 화면이 401 을 "다시 로그인"으로 해석하기 때문이다.
 */
export async function guard(
  request: Request,
  bucket: string,
  limit: number = generalLimit(),
): Promise<Response | null> {
  if (!(await isAuthenticated())) {
    return jsonError("로그인이 필요합니다. 비밀번호를 입력해 주세요.", 401);
  }
  const rate = checkRate(`${bucket}:${clientIp(request)}`, limit);
  if (!rate.ok) {
    return jsonError(`요청이 너무 많습니다. ${rate.retryAfterSec}초 뒤에 다시 시도해 주세요.`, 429, {
      "Retry-After": String(rate.retryAfterSec),
    });
  }
  return null;
}
