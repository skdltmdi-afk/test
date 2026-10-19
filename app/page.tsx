"use client";

import { useEffect, useState, type DragEvent, type FormEvent } from "react";
import { MarkdownView } from "@/components/MarkdownView";
import {
  AudioDecodeError,
  decodeToMono16k,
  encodeWav,
  isSilent,
  planChunks,
  SAMPLE_RATE,
} from "@/lib/audio-chunker";
import { ApiError, postForm, postJson, runPool, transcribeChunkWithRetry } from "@/lib/client-api";
import {
  ACCEPT_ATTR,
  classifyFile,
  formatClock,
  MAX_AUDIO_BYTES,
  MAX_REQUEST_BYTES,
  textFromBytes,
} from "@/lib/text-utils";

type AuthState = "checking" | "login" | "ready";
type Stage = "idle" | "extracting" | "decoding" | "transcribing" | "minutes";

const STAGE_LABEL: Record<Stage, string> = {
  idle: "",
  extracting: "파일에서 글자를 읽는 중…",
  decoding: "음성 파일을 읽는 중… 긴 파일은 1분 넘게 걸릴 수 있습니다.",
  transcribing: "음성을 글로 변환하는 중…",
  minutes: "회의록을 만드는 중… 1~3분 걸릴 수 있습니다.",
};

const byteLength = (text: string) => new TextEncoder().encode(text).length;

export default function Home() {
  const [auth, setAuth] = useState<AuthState>("checking");
  const [passwordRequired, setPasswordRequired] = useState(true);
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");

  const [mode, setMode] = useState<"file" | "paste">("file");
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [pasteText, setPasteText] = useState("");

  const [title, setTitle] = useState("");
  const [datetime, setDatetime] = useState("");
  const [attendees, setAttendees] = useState("");
  const [glossary, setGlossary] = useState("");

  const [stage, setStage] = useState<Stage>("idle");
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState("");

  const [transcript, setTranscript] = useState("");
  const [markdown, setMarkdown] = useState("");
  const [viewMode, setViewMode] = useState<"view" | "edit">("view");
  const [copied, setCopied] = useState(false);

  const busy = stage !== "idle";

  // 처음 열릴 때 로그인 상태 확인
  useEffect(() => {
    fetch("/api/login")
      .then((r) => r.json())
      .then((d: { authenticated?: boolean; passwordRequired?: boolean }) => {
        setPasswordRequired(d.passwordRequired !== false);
        setAuth(d.authenticated ? "ready" : "login");
      })
      .catch(() => setAuth("login"));
  }, []);

  // 작업 중 경과 시간, 그리고 창을 닫으려 할 때 경고
  useEffect(() => {
    if (!busy) return;
    const started = Date.now();
    setElapsed(0);
    const timer = setInterval(() => setElapsed((Date.now() - started) / 1000), 1000);
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => {
      clearInterval(timer);
      window.removeEventListener("beforeunload", warn);
    };
  }, [busy]);

  async function login(e: FormEvent) {
    e.preventDefault();
    setLoginError("");
    try {
      await postJson("/api/login", { password });
      setPassword("");
      setAuth("ready");
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : "로그인하지 못했습니다.");
    }
  }

  async function logout() {
    await fetch("/api/login", { method: "DELETE" });
    setAuth("login");
  }

  function pickFile(next: File | undefined) {
    if (!next) return;
    setError("");
    const kind = classifyFile(next.name);
    if (kind === "unsupported") {
      setError("지원하지 않는 파일 형식입니다. 텍스트(.txt .md .srt .vtt), 문서(.docx .pdf), 음성(.mp3 .m4a .wav .mp4 등) 파일을 올려 주세요.");
      return;
    }
    if (kind === "audio" && next.size > MAX_AUDIO_BYTES) {
      setError(`음성 파일이 너무 큽니다. ${MAX_AUDIO_BYTES / 1024 / 1024}MB 이하로 올려 주세요.`);
      return;
    }
    if (kind !== "audio" && next.size > MAX_REQUEST_BYTES) {
      setError(`텍스트 파일이 너무 큽니다. ${(MAX_REQUEST_BYTES / 1_000_000).toFixed(1)}MB 이하로 올려 주세요.`);
      return;
    }
    setFile(next);
  }

  function onDrop(e: DragEvent<HTMLLabelElement>) {
    e.preventDefault();
    setDragOver(false);
    pickFile(e.dataTransfer.files?.[0]);
  }

  /** 입력(파일 또는 붙여넣기)에서 녹취 텍스트를 얻는다. 음성은 조각내어 변환한다. */
  async function obtainTranscript(): Promise<string> {
    if (mode === "paste") {
      const text = pasteText.trim();
      if (!text) throw new Error("녹취 텍스트를 붙여넣어 주세요.");
      return text;
    }

    if (!file) throw new Error("파일을 선택해 주세요.");
    const kind = classifyFile(file.name);

    if (kind === "text") {
      setStage("extracting");
      const text = textFromBytes(file.name, new Uint8Array(await file.arrayBuffer()));
      if (!text) throw new Error("파일에서 읽을 수 있는 글자가 없습니다.");
      return text;
    }

    if (kind === "doc") {
      setStage("extracting");
      const form = new FormData();
      form.append("file", file);
      const { text } = await postForm<{ text: string }>("/api/extract", form);
      return text;
    }

    // 음성: 브라우저에서 2분 안팎 조각으로 나눠 서버로 보낸다.
    setStage("decoding");
    const samples = await decodeToMono16k(file);
    const specs = planChunks(samples);
    const pieces: string[] = new Array(specs.length).fill("");
    let done = 0;
    setProgress({ done: 0, total: specs.length });
    setStage("transcribing");

    await runPool(specs, 3, async (spec) => {
      if (!isSilent(samples, spec)) {
        const text = await transcribeChunkWithRetry(encodeWav(samples, spec), glossary);
        pieces[spec.index] = text.trim();
      }
      done += 1;
      setProgress({ done, total: specs.length });
    });

    const text = specs
      .filter((s) => pieces[s.index])
      .map((s) => `[${formatClock(s.start / SAMPLE_RATE)}] ${pieces[s.index]}`)
      .join("\n\n");
    if (!text) throw new Error("음성에서 인식된 말이 없습니다. 녹음 상태를 확인해 주세요.");
    return text;
  }

  async function buildMinutes(text: string) {
    if (byteLength(text) > MAX_REQUEST_BYTES) {
      throw new Error(
        `녹취가 너무 깁니다 (${(byteLength(text) / 1_000_000).toFixed(1)}MB). ${(MAX_REQUEST_BYTES / 1_000_000).toFixed(1)}MB 이하로 나누어 올려 주세요.`,
      );
    }
    setStage("minutes");
    const res = await postJson<{ markdown: string }>("/api/minutes", {
      transcript: text,
      title,
      datetime,
      attendees,
      glossary,
    });
    setMarkdown(res.markdown);
    setViewMode("view");
  }

  function showError(err: unknown) {
    if (err instanceof ApiError && err.status === 401) setAuth("login");
    if (err instanceof AudioDecodeError || err instanceof Error) setError(err.message);
    else setError("알 수 없는 오류가 발생했습니다.");
  }

  async function run() {
    setError("");
    setMarkdown("");
    setTranscript("");
    try {
      const text = await obtainTranscript();
      setTranscript(text);
      await buildMinutes(text);
    } catch (err) {
      showError(err);
    } finally {
      setStage("idle");
    }
  }

  async function regenerate() {
    setError("");
    try {
      await buildMinutes(transcript);
    } catch (err) {
      showError(err);
    } finally {
      setStage("idle");
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(markdown);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("복사하지 못했습니다. 편집 탭에서 직접 선택해 복사해 주세요.");
    }
  }

  function download() {
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `회의록_${new Date().toLocaleDateString("sv-SE")}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (auth === "checking") {
    return <main className="page"><p className="muted">불러오는 중…</p></main>;
  }

  if (auth === "login") {
    return (
      <main className="page">
        <form className="card login-card" onSubmit={login}>
          <h1>회의록 작성</h1>
          <p className="notice">팀 공용 비밀번호를 입력해 주세요.</p>
          <div className="field">
            <label htmlFor="password">비밀번호</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
            />
          </div>
          {loginError && <div className="error" role="alert">{loginError}</div>}
          <div className="actions" style={{ marginTop: 16 }}>
            <button className="primary" type="submit" disabled={!password}>들어가기</button>
          </div>
        </form>
      </main>
    );
  }

  const canRun = !busy && (mode === "file" ? Boolean(file) : pasteText.trim().length > 0);
  const percent = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <main className="page">
      <div className="topbar">
        <h1>회의록 작성</h1>
        {passwordRequired && <button onClick={logout} disabled={busy}>로그아웃</button>}
      </div>

      <p className="notice">
        올린 녹취와 음성은 음성 변환과 회의록 생성을 위해 OpenAI 서비스로 전송됩니다. 이 사이트는 파일과 결과를 서버에 저장하지 않습니다.
      </p>

      <section className="card" aria-labelledby="input-title">
        <h2 id="input-title">1. 녹취 올리기</h2>
        <div className="tabs">
          <button className="tab" aria-pressed={mode === "file"} onClick={() => setMode("file")} disabled={busy}>
            파일 올리기
          </button>
          <button className="tab" aria-pressed={mode === "paste"} onClick={() => setMode("paste")} disabled={busy}>
            텍스트 붙여넣기
          </button>
        </div>

        {mode === "file" ? (
          <>
            <label
              className={`dropzone${dragOver ? " over" : ""}`}
              htmlFor="file-input"
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
            >
              {file ? (
                <>
                  <strong>{file.name}</strong>
                  <div className="hint">{(file.size / 1024 / 1024).toFixed(1)}MB · 다른 파일을 올리려면 다시 선택하세요</div>
                </>
              ) : (
                <>
                  파일을 끌어다 놓거나 눌러서 선택하세요
                  <div className="hint">텍스트 .txt .md .srt .vtt · 문서 .docx .pdf · 음성 .mp3 .m4a .wav .mp4 등</div>
                </>
              )}
              <input
                id="file-input"
                className="hidden-input"
                type="file"
                accept={ACCEPT_ATTR}
                disabled={busy}
                onChange={(e) => { pickFile(e.target.files?.[0]); e.target.value = ""; }}
              />
            </label>
            <p className="hint">
              음성은 이 기기의 브라우저에서 2분 안팎으로 나누어 변환합니다. 3시간 이하, 500MB 이하의 녹음을 권장하며, 변환 중에는 창을 닫지 마세요.
            </p>
          </>
        ) : (
          <div className="field">
            <label htmlFor="paste">녹취 텍스트</label>
            <textarea
              id="paste"
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder="회의 녹취 텍스트를 붙여넣으세요."
              disabled={busy}
            />
          </div>
        )}
      </section>

      <section className="card">
        <details>
          <summary>2. 회의 정보와 용어 (선택)</summary>
          <div className="grid">
            <div className="field">
              <label htmlFor="title">회의명</label>
              <input id="title" type="text" value={title} onChange={(e) => setTitle(e.target.value)} disabled={busy} />
            </div>
            <div className="field">
              <label htmlFor="datetime">일시</label>
              <input id="datetime" type="text" placeholder="예: 2026-10-19 14:00" value={datetime} onChange={(e) => setDatetime(e.target.value)} disabled={busy} />
            </div>
          </div>
          <div className="field">
            <label htmlFor="attendees">참석자</label>
            <input id="attendees" type="text" placeholder="예: 김민수, 박지연" value={attendees} onChange={(e) => setAttendees(e.target.value)} disabled={busy} />
            <div className="hint">입력한 값은 이름 표기를 맞추는 참고용입니다. 회의록 머리말에는 &quot;입력&quot;이라고 표시됩니다.</div>
          </div>
          <div className="field">
            <label htmlFor="glossary">용어 사전</label>
            <textarea id="glossary" style={{ minHeight: 80 }} placeholder={"사람 이름, 제품명을 한 줄에 하나씩\n예: 견적서\n리모에듀"} value={glossary} onChange={(e) => setGlossary(e.target.value)} disabled={busy} />
            <div className="hint">음성 변환과 회의록 작성에서 철자를 맞추는 데 쓰입니다.</div>
          </div>
        </details>
      </section>

      <div className="actions">
        <button className="primary" onClick={run} disabled={!canRun}>회의록 만들기</button>
      </div>

      {busy && (
        <div className="progress" role="status" aria-live="polite">
          <div>
            {stage === "transcribing"
              ? `${STAGE_LABEL.transcribing} ${progress.done}/${progress.total}`
              : STAGE_LABEL[stage]}
            <span className="muted"> · {formatClock(elapsed)}</span>
          </div>
          {stage === "transcribing" && (
            <div className="bar" aria-hidden="true"><div style={{ width: `${percent}%` }} /></div>
          )}
        </div>
      )}

      {error && <div className="error" role="alert">{error}</div>}

      {markdown && (
        <section className="card" style={{ marginTop: 24 }} aria-labelledby="result-title">
          <div className="result-head">
            <h2 id="result-title">3. 회의록</h2>
            <div className="actions">
              <button className="tab" aria-pressed={viewMode === "view"} onClick={() => setViewMode("view")}>보기</button>
              <button className="tab" aria-pressed={viewMode === "edit"} onClick={() => setViewMode("edit")}>편집</button>
              <button onClick={copy}>{copied ? "복사됨" : "복사"}</button>
              <button onClick={download}>.md 저장</button>
            </div>
          </div>
          {viewMode === "view" ? (
            <MarkdownView source={markdown} />
          ) : (
            <textarea
              className="transcript"
              style={{ minHeight: 360 }}
              value={markdown}
              onChange={(e) => setMarkdown(e.target.value)}
              aria-label="회의록 마크다운 편집"
            />
          )}
          <p className="hint">⚠ 표시는 근거 문장을 녹취에서 찾지 못한 항목입니다. 반드시 원문과 대조해 주세요.</p>
        </section>
      )}

      {transcript && (
        <section className="card">
          <details>
            <summary>녹취 원문 보기 · 고쳐서 다시 만들기</summary>
            <textarea
              className="transcript"
              value={transcript}
              onChange={(e) => setTranscript(e.target.value)}
              disabled={busy}
              aria-label="녹취 원문"
            />
            <div className="actions" style={{ marginTop: 12 }}>
              <button onClick={regenerate} disabled={busy || !transcript.trim()}>이 원문으로 회의록 다시 만들기</button>
            </div>
          </details>
        </section>
      )}
    </main>
  );
}
