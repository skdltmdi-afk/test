import { NextResponse } from "next/server";
import {
  authDisabled,
  COOKIE_MAX_AGE_SEC,
  COOKIE_NAME,
  isAuthenticated,
  passwordConfigured,
  passwordMatches,
  sessionToken,
} from "@/lib/auth";
import { jsonError } from "@/lib/guard";
import { checkRate, clientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";

/** 화면이 처음 열릴 때 로그인 상태를 확인한다. */
export async function GET() {
  return Response.json({
    authenticated: await isAuthenticated(),
    passwordRequired: !authDisabled(),
  });
}

export async function POST(request: Request) {
  // 비밀번호 대입 공격을 막기 위해 로그인 시도는 분당 5회로 제한한다.
  const rate = checkRate(`login:${clientIp(request)}`, 5);
  if (!rate.ok) {
    return jsonError(`시도가 너무 많습니다. ${rate.retryAfterSec}초 뒤에 다시 시도해 주세요.`, 429, {
      "Retry-After": String(rate.retryAfterSec),
    });
  }

  if (authDisabled()) return Response.json({ ok: true });

  if (!passwordConfigured()) {
    return jsonError("서버에 APP_PASSWORD 가 설정되지 않았습니다. 관리자에게 문의해 주세요.", 500);
  }

  let password = "";
  try {
    const body = (await request.json()) as { password?: unknown };
    password = typeof body.password === "string" ? body.password : "";
  } catch {
    return jsonError("요청 형식이 올바르지 않습니다.", 400);
  }

  if (!passwordMatches(password)) {
    return jsonError("비밀번호가 올바르지 않습니다.", 401);
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE_NAME, sessionToken(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: COOKIE_MAX_AGE_SEC,
  });
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE_NAME, "", { httpOnly: true, path: "/", maxAge: 0 });
  return res;
}
