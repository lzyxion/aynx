/**
 * **로컬 타일이 지금 무엇인가** — 아이콘과 이름을 **한 번에** 정하는 순수 규칙 하나.
 *
 * 앞자리 아이콘(`PaneIcon.svelte`)과 표시 이름(`app/titles` 의 `displayName`)은 같은 물음에
 * 답한다: "이 칸에서 지금 도는 것이 무엇이냐". 그 규칙이 두 파일에 나뉘어 있던 동안에도
 * 답은 같았는데, **AI 를 손으로 띄운 경우**를 더하면서 갈림이 하나 늘었다 — 나뉜 채로 두면
 * 아이콘은 Claude 인데 이름은 PowerShell 인 타일이 생긴다. 그래서 갈림을 여기 하나로 모으고
 * 두 자리는 이 함수의 `icon`·`name` 을 각각 꺼내 쓴다.
 *
 * ## 신호는 인자로 받는다 (그래서 순수하다)
 *
 * 네 신호는 전부 `app/titles.svelte.ts` 의 반응형 맵에 산다. 그 맵을 여기서 읽으면 이 모듈이
 * 룬 모듈이 되어 vitest 대상에서 빠진다(`vitest.config.ts` 의 대상 규칙). 반대로 **값으로
 * 받으면** 규칙 전체가 표 하나로 테스트된다 — 부르는 쪽은 맵에서 꺼내 넘기기만 한다.
 *
 * ## 순서 (먼저 걸리는 것이 답)
 *
 * | # | 신호 | 답 | 왜 이 자리인가 |
 * | --- | --- | --- | --- |
 * | ① | `autorun` 이 AI CLI | 그 CLI | **우리가 띄웠다** — 가장 확실한 앎이다 |
 * | ② | 지금 도는 명령이 AI CLI | 그 CLI | 사용자가 PowerShell 에서 직접 쳤다 (OSC 133 `C` — `cd x; claude` 처럼 앞에 다른 명령을 달아도) |
 * | ③ | OSC 제목에 "Claude Code" | claude | ②가 없는 셸(cmd.exe)의 마지막 그물 |
 * | ③′ | 그 타일의 스트림에 온 훅 신호가 밝힌 CLI (`signalAttested`) | 그 CLI | ①②③ 이 다 없는 타일(tmux 안에서 손으로 띄운 `codex` — 제목이 폴더 이름)의 마지막 그물 |
 * | ④ | — | 셸 로고 + (의미 있는 OSC 제목 ‖ 셸 이름) | 지금까지의 규칙 그대로 |
 *
 * ③′(2026-10-08): 훅 스크립트 8판이 신호마다 `cli` 를 싣고, 신호 토큰은 **그 타일의 스트림에만** 통하므로 "이 타일에서
 * 그 CLI 가 돈다" 의 근거가 된다(`app/agent-status` 의 `agentSignal` 이 적는다). 앞 세 갈래 뒤에 두는 이유: 그쪽은 지금
 * 이 순간의 사실이고, 이것은 마지막 신호가 남긴 표식이라 CLI 를 빠져나와도 세션이 끝날 때까지 남을 수 있다.
 *
 * ②가 ③보다 먼저인 이유: 명령은 **셸이 경계를 찍어 준 사실**이고 제목은 프로그램이 제멋대로
 * 바꾸는 글자다. ③을 Claude 에만 두는 것도 같은 까닭이다 — Codex 는 창 제목을 **작업 폴더
 * 이름**(`you`)으로 바꿔서, 그 글자로는 Codex 인지 그냥 그 폴더인지 가를 수 없다. 없는
 * 정보를 지어내느니 셸 이름을 남긴다.
 *
 * ②는 **명령이 끝나면 사라진다**(`133;D` → `null`) — 즉 이름·아이콘이 CLI 를 띄운 동안만
 * 그 CLI 이고 빠져나오면 셸로 돌아온다. 그것이 요점이다: 이 층은 "무엇으로 열었나" 가
 * 아니라 **"지금 무엇이 도는가"** 를 말한다.
 *
 * Svelte 를 import 하지 않는다 — `pane-icons.ts` 와 같은 이유다 (`pane-identity.test.ts`).
 */

import { aiDisplayName, aiFromCommandLine, aiIconName, shellIconName } from "$lib/pane-icons";
import { shellLabel, type Tr } from "$lib/session";

/** 한 로컬 타일의 신호 넷 — 전부 "모른다"(`null`)일 수 있다 */
export interface LocalPaneSignals {
  /** `PaneSpec.autorun` — 이 타일을 열며 **우리가** 자동 실행한 명령 (AI 타일의 표식) */
  autorun?: string | null;
  /**
   * `autorun` 으로 띄운 에이전트가 **끝났다**(셸 프롬프트가 돌아왔다 — `app/titles` 의
   * `markAgentEnded`). 참이면 ①을 건너뛴다: autorun 은 "무엇으로 열었나" 라 끝난 뒤에도 남는데,
   * 이 층은 "지금 무엇이 도는가" 를 말한다. 같은 타일에서 손으로 다시 띄우면 ②가 잡는다.
   */
  agentEnded?: boolean;
  /** 지금 도는 명령 한 줄 (OSC 133 `C`~`D` 사이). 프롬프트로 돌아오면 `null` */
  runningCommand?: string | null;
  /** 셸이 OSC 0/2 로 바꾼 창 제목 */
  oscTitle?: string | null;
  /**
   * 그 타일의 스트림에 온 **훅 신호가 밝힌 CLI**(`"claude"`·`"codex"` — 스크립트 8판의 `cli`). 앞 세 갈래가 모두 없을 때만
   * 본다(③′). 세션이 끝나거나 갈리면 지워진다(`app/titles` 의 `clearSignalAttested`).
   */
  signalAttested?: string | null;
  /** 셸 id — 백엔드가 해석한 것, 없으면 `PaneSpec.shell` (부르는 쪽이 이미 합쳐서 넘긴다) */
  shell?: string | null;
}

/** [`localPaneIdentity`] 의 답 — 아이콘과 이름은 언제나 **같은 근거**에서 나온다 */
export interface PaneIdentity {
  /** 로고 **이름** (`host-icons.generated.ts` 의 키). 그리는 쪽이 `iconRef` 로 감싼다 */
  icon: string;
  /** 헤더·탭·상태바에 뜰 이름 */
  name: string;
  /** AI CLI 로 판정됐으면 그 이름 (`"claude"`·`"codex"`), 아니면 `null` — 부르는 쪽의 단서 */
  ai: string | null;
}

/** OSC 제목으로 알아볼 수 있는 CLI — 제목에 자기 이름을 그대로 적는 것만 (모듈 머리말 ③) */
const TITLE_AI_MARKERS: readonly (readonly [string, string])[] = [["claude code", "claude"]];

/**
 * 로컬 타일의 아이콘·이름. 규칙과 순서는 이 모듈 머리말의 표 참고.
 *
 * `kind:"local"` 전용이다 — SSH·파일 타일은 런타임 신호를 보지 않으므로 부르는 쪽
 * (`displayName`·`PaneIcon`)이 그 갈림을 먼저 친다.
 */
export function localPaneIdentity(sig: LocalPaneSignals, tr: Tr): PaneIdentity {
  const ai = aiOf(sig);
  if (ai !== null) {
    // 이름은 제목을 **무시한다**: CLI 마다 제목을 제멋대로 바꿔서(Claude 는 "✳ Claude Code",
    // Codex 는 작업 폴더 이름) 제목을 믿으면 타일마다 다른 종류의 글자가 뜬다.
    return { icon: ai, name: aiDisplayName(ai) ?? ai, ai };
  }
  const title = sig.oscTitle?.trim() ?? "";
  const meaningful = title !== "" && isMeaningfulTitle(title);
  const name = meaningful ? title : shellLabel(sig.shell ?? undefined, tr);
  return { icon: shellIconName(sig.shell), name, ai: null };
}

/**
 * 네 갈래(①②③③′) 중 먼저 걸리는 AI CLI — 없으면 `null`.
 *
 * **SSH 타일도 이 판정을 쓴다**(`app/agent-status` 의 `agentKindOf` — 2026-10-07: 원격 셸에서 손으로 띄운
 * Claude·Codex 도 AI 타일). 원격의 ②는 서버에 심은 셸 통합(bash·zsh, tmux 밖)이 주고, ③은 원격 프로그램이
 * 보낸 OSC 제목이다. 원격 셸은 프롬프트마다 `user@host: ~/dir` 같은 제목을 흘리므로 **그 모양의 제목은 ③에서
 * 뺀다** — 폴더 이름에 "claude code" 가 들어 있어도 셸 프롬프트 제목이 AI 로 읽히지 않게(로컬에서
 * `ssh user@host` 를 돌린 타일도 같다).
 */
export function aiOf(sig: LocalPaneSignals): string | null {
  const byAutorun = sig.autorun && !sig.agentEnded ? aiIconName(sig.autorun) : null;
  if (byAutorun !== null) return byAutorun;

  const byCommand = sig.runningCommand ? aiFromCommandLine(sig.runningCommand) : null;
  if (byCommand !== null) return byCommand;

  const title = sig.oscTitle?.trim().toLowerCase() ?? "";
  if (title !== "" && !PROMPT_TITLE.test(title)) {
    for (const [needle, icon] of TITLE_AI_MARKERS) if (title.includes(needle)) return icon;
  }

  // ③′ 훅 신호가 밝힌 CLI — 아는 이름만(모르는 글자로 아이콘·이름을 짓지 않는다)
  const attested = sig.signalAttested ?? null;
  if (attested !== null && aiDisplayName(attested) !== null) return aiIconName(attested);
  return null;
}

/**
 * 원격(SSH) 타일의 표시 이름 — AI 가 붙어 있으면 `Claude Code · dev-01`(이름은 로컬 AI 타일과 같은 `aiDisplayName`).
 * **AI 가 앞이다**(2026-10-08 사용자 결정) — 아이콘도 AI 로고가 앞, 호스트 아이콘이 뒤에 반쯤 가려 선다(`PaneIcon`).
 */
export function remotePaneName(host: string, ai: string | null): string {
  return ai === null ? host : `${aiDisplayName(ai) ?? ai} · ${host}`;
}

/** 셸 프롬프트가 흘리는 `user@host:cwd` 모양의 제목 — 제목 표식(③)을 보지 않는다 */
const PROMPT_TITLE = /^[^\s@]+@[^\s:]+:/;

/**
 * OSC 제목이 **의미 있는가** — 셸이 시작하며 흘리는 잡음(자기 exe 경로·cwd 경로)이면
 * 무시하고 깨끗한 셸 이름을 남긴다. 호스트를 가리키는 제목(`user@host…`)은 뒤에 cwd 를
 * 달고 와도(`user@host: ~/dir`) 그대로 살린다 — `@` 하나가 "이건 원격 세션이다" 의 표식이다.
 *
 * 걸러 내는 것: pwsh 가 시작에 넣는 자기 실행 경로(`…\pwsh.exe`) · Git Bash 시작 제목
 * (`MINGW64:/c/…`) · 매 프롬프트의 cwd 경로(`C:\Users\…`·`/home/…`). 이런 경로 잡음은
 * "어떤 셸이냐" 도 "어디냐" 도 말해 주지 않으므로, 대신 깨끗한 셸 이름을 보인다.
 */
export function isMeaningfulTitle(title: string): boolean {
  const s = title.trim();
  if (!s) return false;
  if (s.includes("@")) return true; // user@host — 원격 식별자는 경로를 달고 와도 살린다
  if (/\.exe$/i.test(s)) return false; // pwsh.exe · powershell.exe 시작 경로
  if (/^[A-Za-z]:[\\/]/.test(s)) return false; // C:\… · C:/…
  if (s.startsWith("/")) return false; // /home/…
  if (/^(MINGW|MSYS)/i.test(s)) return false; // Git Bash 시작 제목 "MINGW64:/c/…"
  if (s.includes("\\")) return false; // 그 밖의 윈도 경로
  return true;
}
