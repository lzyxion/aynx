// 앱 안 업데이트의 순수 판정 — 알리기만 하고 내려받기 · 설치는 사람이 고를 때만. 상태의 주인은 Rust `updater.rs` 다.

export const AUTO_CHECK_MS = 6 * 60 * 60 * 1000;

/** 복원 · 세션 붙기와 겹치지 않게 한 박자 */
export const FIRST_CHECK_DELAY_MS = 15_000;

/** Rust `updater::Phase` */
export type UpdatePhase = "idle" | "available" | "downloading" | "ready" | "installing" | "failed";

/** Rust `updater::Available` */
export interface UpdateAvailable {
  version: string;
  /** 마크다운 */
  notes: string;
  /** RFC 3339 */
  date: string | null;
  page: string;
}

/** Rust `updater::View` — `update_state` 의 답 · 이벤트 `update-state` 의 몸 */
export interface UpdateView {
  current: string;
  phase: UpdatePhase;
  checking: boolean;
  available: UpdateAvailable | null;
  received: number;
  total: number | null;
  error: string | null;
  failedAt: "download" | "install" | null;
  checkError: string | null;
  checkedAt: number | null;
  skipped: string | null;
  toasted: string | null;
  /** 클수록 나중 상태 — Rust 가 사본을 뜰 때 붙인다 */
  rev: number;
}

/** 명령의 답과 이벤트는 순서가 섞여 닿는다(`ready` 이벤트가 `downloading` 답보다 먼저 올 수 있다) — 차례로 거른다 */
export function isNewerView(held: UpdateView | null, next: UpdateView): boolean {
  return held === null || next.rev >= held.rev;
}

/** Rust `updater::EVENT` */
export const UPDATE_EVENT = "update-state";

/** 숫자 마디가 같으면 꼬리(`-rc.1`)가 있는 쪽이 작다 — semver 와 같은 뜻 */
export function compareVersions(a: string, b: string): number {
  const split = (v: string) => {
    const s = v.trim().replace(/^v/i, "");
    const dash = s.indexOf("-");
    const core = dash < 0 ? s : s.slice(0, dash);
    const pre = dash < 0 ? "" : s.slice(dash + 1);
    return { nums: core.split(".").map((n) => Number.parseInt(n, 10) || 0), pre };
  };
  const x = split(a);
  const y = split(b);
  const len = Math.max(x.nums.length, y.nums.length, 3);
  for (let i = 0; i < len; i++) {
    const d = (x.nums[i] ?? 0) - (y.nums[i] ?? 0);
    if (d !== 0) return d;
  }
  if (x.pre === y.pre) return 0;
  if (x.pre === "") return 1;
  if (y.pre === "") return -1;
  return x.pre < y.pre ? -1 : 1;
}

/** 건너뛴 판과 같거나 낮으면 건너뛴 것이다 — 더 새 판은 다시 보인다 */
export function isSkipped(version: string, skipped: string | null): boolean {
  return skipped !== null && skipped !== "" && compareVersions(version, skipped) <= 0;
}

/**
 * 사람이 [업데이트]를 고른 뒤에는 건너뛰기를 보지 않는다 — 고른 것이 곧 답이다.
 * 실패는 예외다 — 실패 카드의 [이 버전 건너뛰기]가 빨간 칩을 걷는 길이다.
 */
export function shownVersion(view: UpdateView | null): string | null {
  const v = view?.available?.version ?? null;
  if (v === null || !view) return null;
  if ((view.phase === "available" || view.phase === "failed") && isSkipped(v, view.skipped)) return null;
  if (view.phase === "idle") return null;
  return v;
}

/** 판마다 한 번 — `toasted` 는 Rust 가 적는다 */
export function shouldToast(view: UpdateView | null): boolean {
  if (!view || view.phase !== "available") return false;
  const v = shownVersion(view);
  return v !== null && view.toasted !== v;
}

export type UpdateChip =
  | { kind: "none" }
  | { kind: "available"; version: string }
  | { kind: "downloading"; version: string; pct: number | null }
  | { kind: "ready"; version: string }
  | { kind: "installing"; version: string }
  | { kind: "failed"; version: string };

/** 칩에 보이는 글자는 UI 언어와 상관없이 늘 영어다(사용자 결정 — 폭 · 모양이 바뀌지 않게) · 툴팁 · 접근성 이름은 번역한다 */
export const CHIP_TEXT = {
  ready: "Restart to update",
  failed: "Update failed",
  installing: "Restarting…",
} as const;

export function chipLabel(chip: UpdateChip): string {
  switch (chip.kind) {
    case "available":
      return chip.version;
    case "downloading":
      return chip.pct === null ? "…" : `${chip.pct}%`;
    case "ready":
      return CHIP_TEXT.ready;
    case "failed":
      return CHIP_TEXT.failed;
    case "installing":
      return CHIP_TEXT.installing;
    default:
      return "";
  }
}

export function chipOf(view: UpdateView | null): UpdateChip {
  const version = shownVersion(view);
  if (!view || version === null) return { kind: "none" };
  switch (view.phase) {
    case "available":
      return { kind: "available", version };
    case "downloading":
      return { kind: "downloading", version, pct: percent(view.received, view.total) };
    case "ready":
      return { kind: "ready", version };
    case "installing":
      return { kind: "installing", version };
    case "failed":
      return { kind: "failed", version };
    default:
      return { kind: "none" };
  }
}

export function percent(received: number, total: number | null): number | null {
  if (total === null || !(total > 0)) return null;
  return Math.max(0, Math.min(100, Math.floor((received / total) * 100)));
}

/** 1 MB = 1,000,000 바이트 — 내려받기 창들의 관습 */
export function megabytes(bytes: number): string {
  return (Math.max(0, bytes) / 1_000_000).toFixed(1);
}

export type BusyKind = "ai" | "shell" | "plan";

export interface BusyItem {
  kind: BusyKind;
  name: string;
}

export interface BusySummary {
  sessions: number;
  busy: BusyItem[];
  idle: number;
}

/** 작업안은 세션이 아니라 세지 않고 이름만 싣는다 — 업데이트가 그것도 끊는다는 사실을 보이려는 것이다 */
export function summarizeBusy(input: {
  sessions: number | null;
  ai: readonly string[];
  shell: readonly string[];
  plans: readonly string[];
}): BusySummary {
  const busy: BusyItem[] = [
    ...input.ai.map((name) => ({ kind: "ai" as const, name: name.trim() || "?" })),
    ...input.shell.map((name) => ({ kind: "shell" as const, name: name.trim() || "?" })),
    ...input.plans.map((name) => ({ kind: "plan" as const, name: name.trim() || "?" })),
  ];
  const busySessions = input.ai.length + input.shell.length;
  const sessions = Math.max(input.sessions ?? 0, busySessions);
  return { sessions, busy, idle: Math.max(0, sessions - busySessions) };
}
