/**
 * **앱 안 업데이트의 순수 판정**(2026-11-12 — 사용자 결정 "알리기만 한다. 내려받기 · 설치는 사람이 고를 때만").
 *
 * 상태의 주인은 Rust(`src-tauri/src/updater.rs` — 찾기 · 받기 · 설치 · `updater.json`)이고 화면은 그 [`UpdateView`] 를 받는다.
 * 여기는 그 모양을 **무엇을 보일지**로 바꾸는 함수만 둔다 — 판 견주기 · 건너뛴 판 · 한 번만 알리기 · 상태바 칩 · 진행 글자 ·
 * 바쁜 세션 요약. 룬도 `invoke` 도 없다(vitest 가 그대로 읽는다). 상태 · 이벤트 · 토스트는 `app/updater.svelte.ts`.
 */

/** 시작 뒤 · 그다음 자동 확인의 간격 — 6시간 */
export const AUTO_CHECK_MS = 6 * 60 * 60 * 1000;

/** 부팅 직후 첫 자동 확인까지 — 복원 · 세션 붙기와 겹치지 않게 한 박자 */
export const FIRST_CHECK_DELAY_MS = 15_000;

/** Rust `updater::Phase` */
export type UpdatePhase = "idle" | "available" | "downloading" | "ready" | "installing" | "failed";

/** Rust `updater::Available` */
export interface UpdateAvailable {
  version: string;
  /** 릴리스 노트(마크다운) — 없으면 빈 글자 */
  notes: string;
  /** RFC 3339 — 없으면 `null` */
  date: string | null;
  /** 릴리스 페이지 */
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
  /** 사본의 차례 — 클수록 나중 상태(Rust 가 사본을 뜰 때 붙인다) */
  rev: number;
}

/**
 * 받은 사본이 쥔 것보다 **늦지 않은가** — 명령의 답과 이벤트는 순서가 섞여 닿는다(받기가 곧바로 끝나면 `ready` 이벤트가 `downloading`
 * 답보다 먼저 온다 — 2026-11-12 실기). 차례가 작은 것은 버리고 같은 것은 받는다.
 */
export function isNewerView(held: UpdateView | null, next: UpdateView): boolean {
  return held === null || next.rev >= held.rev;
}

/** 이벤트 이름(Rust `updater::EVENT`) */
export const UPDATE_EVENT = "update-state";

/**
 * 판 견주기 — `a < b` 면 음수 · 같으면 0 · 크면 양수. 앞의 `v` 는 뗀다. 숫자 마디끼리 견주고, 같으면 꼬리(`-rc.1` 같은 미리보기)가
 * **있는 쪽이 작다**(semver 와 같은 뜻 — 꼬리끼리는 글자 비교). 피드는 정식 판만 내므로 꼬리는 드물다.
 */
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

/** 이 판을 사람이 건너뛰었나 — 건너뛴 판과 **같거나 낮으면** 건너뛴 것이다(더 새 판은 다시 보인다) */
export function isSkipped(version: string, skipped: string | null): boolean {
  return skipped !== null && skipped !== "" && compareVersions(version, skipped) <= 0;
}

/**
 * 알릴 새 판 — 찾았고 건너뛰지 않은 판의 글자(없으면 `null`). 사람이 이미 [업데이트]를 고른 뒤(받는 중 · 받아 둠 · 설치 중)에는
 * 건너뛰기를 보지 않는다 — 그 판을 고른 것이 곧 사람의 답이다. **실패**는 예외다: 실패 카드의 [이 버전 건너뛰기]가 빨간 `!` 칩을
 * 걷는 길이다(2026-11-12 사용자 — 안 그러면 건너뛰어도 칩이 남는다).
 */
export function shownVersion(view: UpdateView | null): string | null {
  const v = view?.available?.version ?? null;
  if (v === null || !view) return null;
  if ((view.phase === "available" || view.phase === "failed") && isSkipped(v, view.skipped)) return null;
  if (view.phase === "idle") return null;
  return v;
}

/** 새 판 알림(토스트)을 띄울 때인가 — 판마다 한 번(`toasted` 는 Rust 가 적는다) · 건너뛴 판은 아니다 */
export function shouldToast(view: UpdateView | null): boolean {
  if (!view || view.phase !== "available") return false;
  const v = shownVersion(view);
  return v !== null && view.toasted !== v;
}

/** 상태바 칩 — 없음 · 새 판 · 받는 중(퍼센트) · 다시 시작 · 다시 시작하는 중 · 실패 */
export type UpdateChip =
  | { kind: "none" }
  | { kind: "available"; version: string }
  | { kind: "downloading"; version: string; pct: number | null }
  | { kind: "ready"; version: string }
  | { kind: "installing"; version: string }
  | { kind: "failed"; version: string };

/**
 * 칩에 **보이는 글자** — UI 언어와 상관없이 늘 영어다(2026-11-12 사용자 결정: 상태바 칩은 글리프 같은 이름표라 언어마다 폭 · 모양이
 * 바뀌지 않게). 툴팁 · 접근성 이름 · 카드 · 알림 · 설정은 그대로 번역한다(`app.update.*`).
 */
export const CHIP_TEXT = {
  ready: "Restart to update",
  failed: "Update failed",
  installing: "Restarting…",
} as const;

/** 칩의 보이는 글자 — 새 판은 판 글자 · 받는 중은 `42%`(길이를 모르면 `…`) · 없으면 빈 글자 */
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

/** 지금 칩 */
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

/** 받은 비율(0~100 정수) — 전체 길이를 모르면 `null` */
export function percent(received: number, total: number | null): number | null {
  if (total === null || !(total > 0)) return null;
  return Math.max(0, Math.min(100, Math.floor((received / total) * 100)));
}

/** 바이트 → `14.2` 같은 MB 글자(소수 한 자리 · 1 MB = 1,000,000 바이트 — 내려받기 창들의 관습) */
export function megabytes(bytes: number): string {
  return (Math.max(0, bytes) / 1_000_000).toFixed(1);
}

/** 바쁜 세션의 종류 — AI 턴 · 셸에서 도는 명령 · 실행 중인 작업안 */
export type BusyKind = "ai" | "shell" | "plan";

export interface BusyItem {
  kind: BusyKind;
  name: string;
}

/** 경고 상자의 요약 — 끝날 세션 수 · 그중 바쁜 것 · 나머지(유휴) */
export interface BusySummary {
  sessions: number;
  busy: BusyItem[];
  idle: number;
}

/**
 * 바쁜 것 모으기 → 요약. `sessions` 는 세션 서버가 센 살아 있는 세션 수(모르면 `null` — 그때는 바쁜 것 수 이상으로 잡는다).
 * 작업안은 세션이 아니라 세지 않고(`idle` 에 영향 없음) 이름만 싣는다 — 업데이트가 그것도 끊는다는 사실을 보이려는 것이다.
 */
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
