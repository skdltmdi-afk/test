import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

export const COOKIE_NAME = "mm_session";
export const COOKIE_MAX_AGE_SEC = 60 * 60 * 24 * 30;

function configuredPassword(): string {
  return process.env.APP_PASSWORD ?? "";
}

/** 개발 환경에서 APP_PASSWORD 가 비어 있으면 비밀번호 없이 쓸 수 있다. 운영에서는 항상 필요하다. */
export function authDisabled(): boolean {
  return !configuredPassword() && process.env.NODE_ENV !== "production";
}

export function passwordConfigured(): boolean {
  return Boolean(configuredPassword());
}

/** 길이가 달라도 안전하게 비교하기 위해 해시한 값끼리 비교한다. */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

export function passwordMatches(input: string): boolean {
  const secret = configuredPassword();
  if (!secret) return false;
  return safeEqual(input, secret);
}

/** 비밀번호에서 파생한 세션 값. 비밀번호를 바꾸면 기존 로그인은 모두 무효가 된다. */
export function sessionToken(): string {
  return createHmac("sha256", configuredPassword()).update("meeting-minutes-session-v1").digest("hex");
}

export async function isAuthenticated(): Promise<boolean> {
  if (authDisabled()) return true;
  if (!configuredPassword()) return false;
  const jar = await cookies();
  const value = jar.get(COOKIE_NAME)?.value;
  if (!value) return false;
  return safeEqual(value, sessionToken());
}
