import type { ReactNode } from "react";

/**
 * 이 앱이 만드는 회의록 마크다운(제목, 목록, 표, 문단)만 그리는 작은 렌더러.
 * 사용자가 고친 마크다운도 같은 규칙으로 그리고, HTML 은 해석하지 않으므로 안전하다.
 */

function splitRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));
}

function isSeparatorRow(line: string): boolean {
  return /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(line) && line.includes("-");
}

/** [미정] 과 ⚠ 를 눈에 띄게 표시한다. */
function inline(text: string): ReactNode[] {
  return text.split(/(\[미정\]|⚠|✔)/).map((part, i) => {
    if (part === "[미정]") return <span key={i} className="tbd">{part}</span>;
    if (part === "⚠") return <span key={i} className="warn">{part}</span>;
    if (part === "✔") return <span key={i} className="ok">{part}</span>;
    return part;
  });
}

export function MarkdownView({ source }: { source: string }) {
  const lines = source.split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i++;
      continue;
    }

    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const content = inline(heading[2]);
      blocks.push(
        level === 1 ? <h2 key={i} className="md-h1">{content}</h2>
        : level === 2 ? <h3 key={i} className="md-h2">{content}</h3>
        : <h4 key={i} className="md-h3">{content}</h4>,
      );
      i++;
      continue;
    }

    if (line.trim().startsWith("|")) {
      const rows: string[][] = [];
      const start = i;
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        if (!isSeparatorRow(lines[i])) rows.push(splitRow(lines[i]));
        i++;
      }
      const [head, ...body] = rows;
      blocks.push(
        <div key={start} className="table-wrap">
          <table>
            <thead>
              <tr>{head?.map((c, k) => <th key={k}>{inline(c)}</th>)}</tr>
            </thead>
            <tbody>
              {body.map((r, ri) => (
                <tr key={ri}>{r.map((c, ci) => <td key={ci}>{inline(c)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    if (/^\s*-\s+/.test(line)) {
      const items: string[] = [];
      const start = i;
      while (i < lines.length && /^\s*-\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*-\s+/, ""));
        i++;
      }
      blocks.push(
        <ul key={start}>
          {items.map((t, k) => <li key={k}>{inline(t)}</li>)}
        </ul>,
      );
      continue;
    }

    blocks.push(<p key={i}>{inline(line)}</p>);
    i++;
  }

  return <div className="md">{blocks}</div>;
}
