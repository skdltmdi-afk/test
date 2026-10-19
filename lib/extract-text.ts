/**
 * 서버에서만 쓰는 텍스트 추출. .docx 와 .pdf 는 브라우저에서 읽을 수 없어 서버가 처리한다.
 * 일반 텍스트 계열 파일은 브라우저에서 바로 읽지만, 같은 함수로 서버에서도 처리할 수 있게 둔다.
 */

import { classifyFile, extensionOf, normalizeText, textFromBytes } from "./text-utils";

export class UnsupportedFileError extends Error {
  constructor(filename: string) {
    super(`지원하지 않는 파일 형식입니다: ${filename}`);
    this.name = "UnsupportedFileError";
  }
}

type MammothModule = {
  extractRawText(input: { buffer: Buffer }): Promise<{ value: string }>;
};

async function extractDocx(bytes: Uint8Array): Promise<string> {
  const mod = (await import("mammoth")) as unknown as MammothModule & { default?: MammothModule };
  const mammoth = mod.default ?? mod;
  const result = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
  return result.value;
}

async function extractPdf(bytes: Uint8Array): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(bytes);
  const { text } = await extractText(pdf, { mergePages: true });
  return text;
}

export async function extractTranscript(file: File): Promise<string> {
  const kind = classifyFile(file.name);
  if (kind !== "text" && kind !== "doc") throw new UnsupportedFileError(file.name);

  const bytes = new Uint8Array(await file.arrayBuffer());
  const ext = extensionOf(file.name);

  let text: string;
  if (ext === "docx") {
    text = normalizeText(await extractDocx(bytes));
  } else if (ext === "pdf") {
    text = normalizeText(await extractPdf(bytes));
    if (!text) {
      throw new Error("PDF에서 글자를 찾지 못했습니다. 스캔한 이미지 PDF는 지원하지 않습니다.");
    }
  } else {
    text = textFromBytes(file.name, bytes);
  }

  if (!text) throw new Error("파일에서 읽을 수 있는 글자가 없습니다.");
  return text;
}
