/**
 * 로컬 타일이 지금 무엇인가 — 아이콘과 이름을 한 근거에서 정한다(나누면 아이콘은 Claude, 이름은 PowerShell 인 타일이 생긴다).
 * 신호는 값으로 받는다 — `app/titles.svelte.ts` 의 맵을 여기서 읽으면 룬 모듈이 되어 vitest 대상에서 빠진다.
 */

import { aiDisplayName, aiFromCommandLine, aiIconName, shellIconName } from "$lib/pane-icons";
import { shellLabel, type Tr } from "$lib/session";

export interface LocalPaneSignals {
  autorun?: string | null;
  /** 참이면 `autorun` 을 건너뛴다 — 이 층은 "무엇으로 열었나" 가 아니라 "지금 무엇이 도는가" 다 */
  agentEnded?: boolean;
  /** OSC 133 `C`~`D` 사이 · 프롬프트로 돌아오면 `null` */
  runningCommand?: string | null;
  oscTitle?: string | null;
  /** 훅 신호가 밝힌 CLI — CLI 를 빠져나와도 남을 수 있는 표식이라 맨 뒤에서만 본다 */
  signalAttested?: string | null;
  shell?: string | null;
}

export interface PaneIdentity {
  /** 로고 이름(`host-icons.generated.ts` 의 키) */
  icon: string;
  name: string;
  ai: string | null;
}

/** 제목에 자기 이름을 그대로 적는 CLI 만 — Codex 는 제목을 작업 폴더 이름으로 바꿔 가를 수 없다 */
const TITLE_AI_MARKERS: readonly (readonly [string, string])[] = [["claude code", "claude"]];

/** `kind:"local"` 전용 */
export function localPaneIdentity(sig: LocalPaneSignals, tr: Tr): PaneIdentity {
  const ai = aiOf(sig);
  if (ai !== null) {
    return { icon: ai, name: aiDisplayName(ai) ?? ai, ai };
  }
  const title = sig.oscTitle?.trim() ?? "";
  const meaningful = title !== "" && isMeaningfulTitle(title);
  const name = meaningful ? title : shellLabel(sig.shell ?? undefined, tr);
  return { icon: shellIconName(sig.shell), name, ai: null };
}

/**
 * 먼저 걸리는 것이 답 — autorun → 지금 도는 명령 → OSC 제목 → 훅 신호. 명령이 제목보다 앞이다(셸이 찍은 경계 vs 프로그램이 바꾸는 글자).
 * SSH 타일도 쓴다(`app/agent-status` 의 `agentKindOf`) — 셸 프롬프트 제목(`user@host:`)은 제목 판정에서 뺀다.
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

  const attested = sig.signalAttested ?? null;
  if (attested !== null && aiDisplayName(attested) !== null) return aiIconName(attested);
  return null;
}

/** AI 가 앞이다(`Claude Code · dev-01`) — 사용자 결정 */
export function remotePaneName(host: string, ai: string | null): string {
  return ai === null ? host : `${aiDisplayName(ai) ?? ai} · ${host}`;
}

const PROMPT_TITLE = /^[^\s@]+@[^\s:]+:/;

/** 셸이 흘리는 경로 잡음(자기 exe · cwd · `MINGW64:`)은 무시한다 — `@` 가 든 제목은 원격 표식이라 살린다 */
export function isMeaningfulTitle(title: string): boolean {
  const s = title.trim();
  if (!s) return false;
  if (s.includes("@")) return true;
  if (/\.exe$/i.test(s)) return false;
  if (/^[A-Za-z]:[\\/]/.test(s)) return false;
  if (s.startsWith("/")) return false;
  if (/^(MINGW|MSYS)/i.test(s)) return false;
  if (s.includes("\\")) return false;
  return true;
}
