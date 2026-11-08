// **떨어진 세션 목록**의 모양과 순수 판정 — 아무 창도 데려가지 않은 세션(설계 4.5 · ③-4).
//
// 목록 자체는 세션 서버가 쥐고 Rust 가 거른다(`detached_sessions` — Detached 이고 (복원이 데려가지 않았거나 ·
// 마지막 창이 지금 없다)). 여기 있는 것은 그 줄을 **어떻게 그리고 어떤 타일로 다시 붙일지**뿐이다(시험 대상).

import { newLocalPane, newSshPane } from "./factory";
import { shellLabel } from "./names";
import type { PaneSpec, Tr } from "./spec";

/** Rust `detached_sessions` 의 한 줄 */
export interface DetachedSession {
  stream: string;
  kind: "local" | "ssh";
  /** 마지막으로 붙어 있던 창 라벨(`main` · `ws-…` · `tear-N`) */
  home: string;
  /** 그 창이 지금 열려 있는가 */
  homeOpen: boolean;
  /** 떨어진 시각(epoch ms) — 모르면 `null` */
  detachedAt: number | null;
  /** 마지막 출력 시각(epoch ms) — 출력이 없었으면 `null` */
  lastOutputAt: number | null;
  openedAt: number;
  /** 로컬 셸 id */
  shell: string | null;
  /** SSH 호스트 별칭 */
  alias: string | null;
  tmux: string | null;
  aiRead: boolean;
  /** 그 창의 복원이 끝났는데 데려가지 않았다 */
  unclaimed: boolean;
}
// (오케스트레이션 3차 3b) 작업자 세션 표지(`orchestration` 칸 · 작업자 스트림 판정)는 걷었다 — 작업자는 헤드리스 턴(프로세스)이라 세션 ·
// 타일이 없다(docs/log/2026-10-16-orchestration-headless-design.md 6-2).

/** 받은 값을 믿을 만한 줄로 거른다 — 모양이 아닌 줄은 버린다(옛 서버·깨진 응답) */
export function parseDetached(raw: unknown): DetachedSession[] {
  if (!Array.isArray(raw)) return [];
  const out: DetachedSession[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    if (typeof o.stream !== "string" || (o.kind !== "local" && o.kind !== "ssh")) continue;
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
    const str = (v: unknown) => (typeof v === "string" && v !== "" ? v : null);
    out.push({
      stream: o.stream,
      kind: o.kind,
      home: typeof o.home === "string" ? o.home : "",
      homeOpen: o.homeOpen === true,
      detachedAt: num(o.detachedAt),
      lastOutputAt: num(o.lastOutputAt),
      openedAt: num(o.openedAt) ?? 0,
      shell: str(o.shell),
      alias: str(o.alias),
      tmux: str(o.tmux),
      aiRead: o.aiRead === true,
      unclaimed: o.unclaimed === true,
    });
  }
  return sortDetached(out);
}

/** 최근에 떨어진 것부터(모르는 시각은 맨 뒤), 같으면 스트림 순 — Rust 와 같은 순서를 다시 굳힌다 */
export function sortDetached(list: readonly DetachedSession[]): DetachedSession[] {
  return [...list].sort((a, b) => {
    const at = a.detachedAt ?? -1;
    const bt = b.detachedAt ?? -1;
    if (at !== bt) return bt - at;
    return a.stream < b.stream ? -1 : a.stream > b.stream ? 1 : 0;
  });
}

/** 줄의 이름 — 로컬은 셸 이름, SSH 는 별칭(tmux 면 `별칭 · tmux 이름`) */
export function detachedName(s: DetachedSession, tr: Tr): string {
  if (s.kind === "local") return shellLabel(s.shell ?? undefined, tr);
  const alias = s.alias ?? tr("app.detached.unknownHost");
  return s.tmux ? `${alias} · ${s.tmux}` : alias;
}

/** 마지막 창의 이름 — 주 창은 말로, 나머지는 라벨 그대로 */
export function detachedWindowName(home: string, tr: Tr): string {
  if (home === "main") return tr("app.detached.window.main");
  if (home.startsWith("tear-")) return tr("app.detached.window.tear", { label: home });
  return home || tr("app.detached.window.unknown");
}

/**
 * [새 탭에 붙이기] 의 타일 — 그 종류의 새 타일을 만들고 **스트림만 그 세션의 것으로** 바꾼다. 터미널의 첫 열기가
 * 이 스트림을 살펴(`probe_session`) 떨어진 세션에 붙는다(`attachDetached`) — 새 셸을 열지 않는다.
 */
export function paneForDetached(s: DetachedSession): PaneSpec {
  const shell = s.shell ?? undefined;
  const pane = s.kind === "local" ? newLocalPane(shell) : newSshPane(s.alias ?? "");
  if (s.kind === "ssh" && s.tmux) pane.tmux = s.tmux;
  pane.historyStreamId = s.stream;
  return pane;
}
