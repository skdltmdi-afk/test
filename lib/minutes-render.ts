/**
 * 모델이 돌려준 구조화 데이터를 고정 양식의 마크다운으로 바꾼다.
 * 양식을 코드가 만들기 때문에 모델이 형식을 어길 수 없고, 점검 항목도 코드가 직접 계산한다.
 */

import { type Minutes, TBD } from "./minutes-schema";

export interface MinutesMeta {
  title: string;
  datetime: string;
  attendees: string;
}

const WARN = "⚠";
const OK = "✔";

function val(value: string | undefined | null): string {
  const t = (value ?? "").trim();
  return t === "" ? TBD : t;
}

function isTbd(value: string | undefined | null): boolean {
  return val(value) === TBD;
}

/** 표 칸에 넣을 수 있게 파이프와 줄바꿈을 정리한다. */
function cell(value: string | undefined | null): string {
  return val(value).replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ");
}

/** 글자·숫자만 남겨 비교한다. 공백, 문장부호, 대소문자 차이를 무시한다. */
function squash(text: string): string {
  return text.normalize("NFC").replace(/[^\p{L}\p{N}]/gu, "").toLowerCase();
}

export function renderMinutes(minutes: Minutes, meta: MinutesMeta, transcript: string): string {
  const haystack = squash(transcript);
  const unverified: string[] = [];

  /** 근거 문장이 녹취에 실제로 있는지 확인한다. 없으면 표시를 붙이고 점검에 모은다. */
  const verify = (label: string, evidence: string): string => {
    const needle = squash(evidence);
    if (needle.length >= 2 && haystack.includes(needle)) return "";
    unverified.push(label);
    return ` ${WARN}`;
  };

  const lines: string[] = [];

  // 머리말: 사용자가 입력한 값만, 녹취가 아니라 입력값이라는 표시와 함께
  lines.push(meta.title ? `# 회의록: ${meta.title}` : "# 회의록");
  const header: string[] = [];
  if (meta.datetime) header.push(`- 일시(입력): ${meta.datetime}`);
  if (meta.attendees) header.push(`- 참석자(입력): ${meta.attendees}`);
  if (header.length > 0) lines.push("", ...header);

  // 목적
  lines.push("", "## 목적");
  const purposeText = val(minutes.purpose.text);
  const purposeMark = isTbd(purposeText) ? "" : verify("목적", minutes.purpose.evidence);
  lines.push(purposeText + purposeMark);

  // 결정사항
  lines.push("", "## 결정사항");
  const decisions = minutes.decisions.filter((d) => d.text.trim() !== "");
  if (decisions.length === 0) {
    lines.push(`- ${TBD}`);
  } else {
    for (const d of decisions) lines.push(`- ${d.text.trim()}${verify(`결정: ${d.text.trim()}`, d.evidence)}`);
  }

  const open = minutes.open_discussions.filter((d) => d.text.trim() !== "");
  if (open.length > 0) {
    lines.push("", "### 논의 중 (결론 없음)");
    for (const d of open) lines.push(`- ${d.text.trim()}${verify(`논의: ${d.text.trim()}`, d.evidence)}`);
  }

  // 액션아이템
  lines.push("", "## 액션아이템 (담당 / 기한)", "", "| 액션아이템 | 담당 | 기한 |", "|---|---|---|");
  const actions = minutes.actions.filter((a) => a.item.trim() !== "");
  if (actions.length === 0) {
    lines.push(`| ${TBD} | ${TBD} | ${TBD} |`);
  } else {
    for (const a of actions) {
      const mark = verify(`액션: ${a.item.trim()}`, a.evidence);
      lines.push(`| ${cell(a.item)}${mark} | ${cell(a.owner)} | ${cell(a.due)} |`);
    }
  }

  // 다음 회의
  const nm = minutes.next_meeting;
  const nextMissing = [
    isTbd(nm.datetime) ? "일시" : "",
    isTbd(nm.place) ? "장소" : "",
    isTbd(nm.agenda) ? "안건" : "",
  ].filter(Boolean);
  lines.push("", "## 다음 회의");
  lines.push(`- 일시: ${val(nm.datetime)}`, `- 장소: ${val(nm.place)}`, `- 안건: ${val(nm.agenda)}`);
  if (nextMissing.length < 3) {
    const mark = verify("다음 회의", nm.evidence);
    if (mark) lines[lines.length - 3] += mark;
  }

  // 점검
  const checks: string[] = [];

  checks.push(isTbd(purposeText) ? `${WARN} 목적이 녹취에서 확인되지 않았습니다.` : `${OK} 목적이 확인되었습니다.`);

  checks.push(
    decisions.length === 0
      ? `${WARN} 결정사항이 한 건도 없습니다. 회의에서 결정된 일이 있었는지 확인해 주세요.`
      : `${OK} 결정사항 ${decisions.length}건`,
  );

  if (actions.length === 0) {
    checks.push(`${WARN} 액션아이템이 한 건도 없습니다. 녹취에 할 일 언급이 있었는지 확인해 주세요.`);
  } else {
    const noOwner = actions.filter((a) => isTbd(a.owner)).length;
    const noDue = actions.filter((a) => isTbd(a.due)).length;
    const mark = noOwner > 0 || noDue > 0 ? WARN : OK;
    checks.push(`${mark} 액션아이템 ${actions.length}건 중 담당 ${TBD} ${noOwner}건, 기한 ${TBD} ${noDue}건`);
  }

  checks.push(
    open.length > 0
      ? `${WARN} 결론 없이 끝난 논의 ${open.length}건 ("논의 중" 항목 참고)`
      : `${OK} 결론 없이 끝난 논의 없음`,
  );

  checks.push(
    nextMissing.length === 0
      ? `${OK} 다음 회의 일시·장소·안건이 모두 확인되었습니다.`
      : nextMissing.length === 3
        ? `${WARN} 다음 회의 정보가 녹취에 없습니다.`
        : `${WARN} 다음 회의 ${nextMissing.join("·")} 미언급`,
  );

  if (unverified.length > 0) {
    checks.push(
      `${WARN} 근거 문장을 녹취에서 찾지 못한 항목 ${unverified.length}건 (본문의 ${WARN} 표시): ${unverified.join(" / ")}`,
    );
  } else {
    checks.push(`${OK} 모든 항목의 근거 문장이 녹취에서 확인되었습니다.`);
  }

  for (const note of minutes.unclear_notes) {
    if (note.trim()) checks.push(`${WARN} ${note.trim()}`);
  }

  lines.push("", "## 점검");
  for (const c of checks) lines.push(`- ${c}`);

  return lines.join("\n") + "\n";
}
