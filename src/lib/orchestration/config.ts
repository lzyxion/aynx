// 앨범 초안과 아티스트 편집이 공유하는 입력값.
import type { Key } from "$lib/i18n/keys";
const MODEL_MAX = 64;
export type RoleCli = "claude" | "codex";
export type LimitKey = "maxConcurrentWorkers" | "maxTotalWorkers" | "coordinationMinutes" | "turnMinutes" | "maxReviews";
export const LIMITS: readonly { key: LimitKey; default: number; max: number; label: Key }[] = [
  { key: "maxConcurrentWorkers", default: 3, max: 3, label: "orch.config.limit.concurrent" },
  { key: "maxTotalWorkers", default: 8, max: 8, label: "orch.config.limit.total" },
  { key: "coordinationMinutes", default: 120, max: 120, label: "orch.config.limit.minutes" },
  { key: "turnMinutes", default: 60, max: 240, label: "orch.config.limit.turn" },
  { key: "maxReviews", default: 6, max: 20, label: "orch.config.limit.reviews" },
];

/** CLI 별 추론 강도(빈 값 = 에이전트 기본값) — Claude `--effort`, Codex `model_reasoning_effort` */
export const EFFORTS: Record<RoleCli, readonly string[]> = {
  claude: ["", "low", "medium", "high", "xhigh", "max"],
  codex: ["", "low", "medium", "high", "xhigh"],
};

/** 모델 이름 제안 — **설치 계정에서 실측된 것만**(Claude 별칭 — 등급 순 `model-order.ts` · 2.1.322 · Codex 는 빈 값 = 에이전트 기본값) */
export const MODEL_SUGGESTIONS: Record<RoleCli, readonly string[]> = {
  claude: ["fable", "opus", "sonnet", "haiku"],
  codex: [],
};

export function modelOk(s: string): boolean {
  return [...s].length <= MODEL_MAX && /^[A-Za-z0-9._:[\]-]*$/.test(s);
}

export function effortOk(cli: RoleCli, s: string): boolean {
  return EFFORTS[cli].includes(s);
}

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;

/** Rust `worktree::comparable` 와 같은 비교 글자 — 구분자 `/` · 끝 구분자 떼기 · Windows 꼴이면 소문자 */
export function cliShort(cli: RoleCli | null): string {
  return cli === "codex" ? "Codex" : cli === "claude" ? "Claude" : "?";
}

/**
 * 역할의 "에이전트 · 모델 · 강도" 칸에서 **에이전트를 뺀 나머지** — 좁은 자리는 에이전트를 로고(`AgentLogo`)로 그리고
 * 이 글자를 뒤에 붙인다. 모델이 비면 `defaultLabel`(기본값) · 강도는 있을 때만.
 */
