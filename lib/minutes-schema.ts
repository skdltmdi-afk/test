import { z } from "zod";

export const TBD = "[미정]";

// ── 검증용 (모델 응답을 받은 뒤 한 번 더 확인) ───────────────

const Evidenced = z.object({ text: z.string(), evidence: z.string() });

export const MinutesSchema = z.object({
  purpose: Evidenced,
  decisions: z.array(Evidenced),
  open_discussions: z.array(Evidenced),
  actions: z.array(
    z.object({
      item: z.string(),
      owner: z.string(),
      due: z.string(),
      evidence: z.string(),
    }),
  ),
  next_meeting: z.object({
    datetime: z.string(),
    place: z.string(),
    agenda: z.string(),
    evidence: z.string(),
  }),
  unclear_notes: z.array(z.string()),
});

export type Minutes = z.infer<typeof MinutesSchema>;

// ── OpenAI 구조화 출력용 JSON 스키마 (strict 모드: 모든 키 required, additionalProperties false) ──

const str = (description: string) => ({ type: "string", description });

const EVIDENCE = str(
  "근거가 되는 녹취 문장을 한 문장(80자 이내) 그대로 복사한 것. 한 글자도 고치거나 요약하지 않는다. 근거가 없으면 빈 문자열.",
);

function evidenced(textDescription: string) {
  return {
    type: "object",
    properties: { text: str(textDescription), evidence: EVIDENCE },
    required: ["text", "evidence"],
    additionalProperties: false,
  };
}

export const MINUTES_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    purpose: evidenced('회의 목적. 녹취에 언급이 없으면 정확히 "[미정]".'),
    decisions: {
      type: "array",
      description: "참석자들이 합의하거나 확정한 내용만. 없으면 빈 배열.",
      items: evidenced("결정된 내용 한 가지."),
    },
    open_discussions: {
      type: "array",
      description: "논의는 있었지만 결론이 나지 않은 내용. 없으면 빈 배열.",
      items: evidenced("결론 없이 끝난 논의 한 가지."),
    },
    actions: {
      type: "array",
      description: "누군가 하기로 한 일. 없으면 빈 배열.",
      items: {
        type: "object",
        properties: {
          item: str("해야 할 일."),
          owner: str('담당자. 녹취에서 불린 이름이나 호칭 그대로. 없으면 정확히 "[미정]".'),
          due: str('기한. 녹취의 표현 그대로(연도·요일·날짜를 새로 계산하지 않는다). 없으면 정확히 "[미정]".'),
          evidence: EVIDENCE,
        },
        required: ["item", "owner", "due", "evidence"],
        additionalProperties: false,
      },
    },
    next_meeting: {
      type: "object",
      properties: {
        datetime: str('다음 회의 일시. 녹취의 표현 그대로. 없으면 정확히 "[미정]".'),
        place: str('다음 회의 장소. 없으면 정확히 "[미정]".'),
        agenda: str('다음 회의 안건. 없으면 정확히 "[미정]".'),
        evidence: EVIDENCE,
      },
      required: ["datetime", "place", "agenda", "evidence"],
      additionalProperties: false,
    },
    unclear_notes: {
      type: "array",
      description: "녹취가 끊겼거나 알아듣기 어렵거나, 이름·숫자가 모호해 사람이 확인해야 할 부분. 없으면 빈 배열.",
      items: { type: "string" },
    },
  },
  required: ["purpose", "decisions", "open_discussions", "actions", "next_meeting", "unclear_notes"],
  additionalProperties: false,
};
