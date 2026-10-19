/**
 * 메모리 기반 요청 횟수 제한.
 * 서버리스 환경에서는 인스턴스마다 따로 세므로 정확한 상한이 아니라 비용 폭증을 막는 안전장치다.
 */

const buckets = new Map<string, number[]>();
let lastSweep = 0;

export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}

function positiveInt(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

export function generalLimit(): number {
  return positiveInt(process.env.RATE_LIMIT_PER_MINUTE, 12);
}

export function transcribeLimit(): number {
  return positiveInt(process.env.RATE_LIMIT_TRANSCRIBE_PER_MINUTE, 60);
}

export function checkRate(
  key: string,
  limit: number,
  windowMs = 60_000,
): { ok: true } | { ok: false; retryAfterSec: number } {
  const now = Date.now();

  if (now - lastSweep > windowMs) {
    lastSweep = now;
    for (const [k, hits] of buckets) {
      if (hits.length === 0 || now - hits[hits.length - 1] > windowMs) buckets.delete(k);
    }
  }

  const recent = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= limit) {
    buckets.set(key, recent);
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((windowMs - (now - recent[0])) / 1000)) };
  }
  recent.push(now);
  buckets.set(key, recent);
  return { ok: true };
}
