# 회의록 작성 사이트

녹취 파일(텍스트, 문서, 음성)을 올리면 정해진 양식의 회의록을 만들어 주는 팀 내부용 사이트입니다.
요구사항은 [PRD.md](PRD.md)를 따릅니다.

> **상태: 코드만 작성됨. 설치, 빌드, 실행, 테스트를 한 번도 하지 않았습니다.**
> 처음 실행할 때 타입 오류나 빌드 오류가 나올 수 있습니다. 아래 "처음 실행" 순서대로 확인하세요.

## 동작 방식

| 입력 | 처리 |
|---|---|
| .txt .md .srt .vtt | 브라우저가 바로 읽음 |
| .docx .pdf | 서버(`/api/extract`)가 글자를 뽑음 |
| 음성 (.mp3 .m4a .wav .mp4 등) | 브라우저가 16kHz 모노로 풀어 조용한 지점에서 2분 안팎 WAV 조각으로 자르고, 조각마다 서버(`/api/transcribe`)가 OpenAI로 변환 |
| 붙여넣은 텍스트 | 그대로 사용 |

그다음 `/api/minutes`가 OpenAI에 구조화 출력(JSON 스키마)으로 요청하고, **코드가** 고정 양식의 마크다운과 점검 항목을 만듭니다.
모델이 양식을 어길 수 없고, 담당·기한 누락 건수 같은 점검은 코드가 직접 계산합니다.
모델이 적은 근거 문장이 녹취에 실제로 있는지도 코드가 확인하고, 없으면 해당 항목에 ⚠를 붙입니다.

음성을 브라우저에서 자르는 이유는 두 가지 제한 때문입니다.
OpenAI 음성 변환은 파일당 25MB 제한이 있고, Vercel 함수는 요청 본문이 4.5MB까지입니다.
16kHz 모노 WAV 120초는 약 3.84MB라서 두 제한을 모두 피합니다.

## 처음 실행

필요한 것: Node.js 20 이상 (개발 PC에는 24 LTS를 설치함)

```bash
npm install
```

`.env.example`을 `.env.local`로 복사하고 값을 채웁니다.

```bash
copy .env.example .env.local
```

| 변수 | 설명 |
|---|---|
| `APP_PASSWORD` | 팀 공용 비밀번호. 운영에서는 필수 |
| `OPENAI_API_KEY` | OpenAI API 키 (음성 변환과 회의록 생성 모두 사용) |
| `OPENAI_STT_MODEL` | 선택. 기본 `gpt-4o-transcribe` |
| `OPENAI_MINUTES_MODEL` | 선택. 기본 `gpt-6.1-sol` |

```bash
npm run typecheck
npm run dev
```

브라우저에서 http://localhost:3000 을 엽니다. 개발 중 `APP_PASSWORD`가 비어 있으면 비밀번호 없이 열립니다.

## Vercel 배포

1. 이 폴더를 Git 저장소로 올리고 Vercel에서 프로젝트로 가져옵니다.
2. 프로젝트 환경변수에 `APP_PASSWORD`, `OPENAI_API_KEY`를 넣습니다.
3. 배포합니다. 회의록 생성은 최대 300초까지 걸릴 수 있어 Hobby 플랜 한도(300초)와 같습니다.

## 알려진 제한

- **화자 구분이 없습니다.** 조각마다 따로 변환하므로 화자 라벨을 일관되게 붙일 수 없습니다. 담당자는 녹취에서 불린 이름이나 호칭으로만 적히고, 없으면 `[미정]`입니다.
- **브라우저 메모리를 씁니다.** 음성을 통째로 풀기 때문에 1시간에 약 230MB가 필요합니다. 3시간 이하, 500MB 이하만 받습니다.
- **변환 중에는 창을 닫으면 안 됩니다.** 진행 상태를 서버에 저장하지 않습니다.
- **요청 횟수 제한은 메모리 기반입니다.** 서버리스 인스턴스마다 따로 세므로 비용 폭증을 막는 안전장치일 뿐 정확한 상한이 아닙니다.
- **`gpt-transcribe` 모델은 요청 형식을 확인하지 못했습니다.** OpenAI 문서에서 `languages`, `keywords`를 어떤 형식으로 보내는지 찾지 못해 `languages[]`, `keywords[]` 반복 필드로 보내도록 추정해 두었습니다. 기본값인 `gpt-4o-transcribe`는 문서화된 방식(`language=ko`)을 씁니다.
- 스캔한 이미지 PDF는 지원하지 않습니다.

## 파일 구조

```
app/page.tsx              화면 전체
app/api/login             공용 비밀번호 로그인
app/api/extract           .docx / .pdf 글자 추출
app/api/transcribe        음성 조각 하나를 OpenAI로 변환
app/api/minutes           회의록 생성
lib/audio-chunker.ts      브라우저에서 음성 풀기, 자르기, WAV 만들기
lib/openai.ts             OpenAI REST 호출 (SDK 없음)
lib/minutes.ts            프롬프트와 생성 흐름
lib/minutes-schema.ts     JSON 스키마와 검증 스키마
lib/minutes-render.ts     마크다운 양식, 점검, 근거 문장 확인
lib/auth.ts, guard.ts, rate-limit.ts   접근 제어
```
