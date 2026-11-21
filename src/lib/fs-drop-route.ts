/**
 * 파일 타일 → 터미널 타일 드롭의 판정 — 순수 함수.
 * 모르면 다른 곳이다 — 안내는 아무것도 망가뜨리지 않지만, 엉뚱한 경로를 붙이면 사람이 그걸 믿고 명령을 친다.
 */
import { LOCAL_KEY } from "$lib/fs-backend";
import type { Key } from "$lib/i18n/keys";
import type { PaneSpec, SessionKind } from "$lib/session/spec";

export type FsDropRoute = "same" | "upload" | "download" | "foreign";

export interface FsDropTarget {
  kind: SessionKind;
  session: number | null;
  /** [`hostIdentity`] */
  host: string | null;
}

/** `"ssh:12"` → `12`. 로컬 · `ssh:none` · 모르는 모양은 `null` */
export function sessionOfFsKey(key: string): number | null {
  const m = /^ssh:(\d+)$/.exec(key);
  return m ? Number(m[1]) : null;
}

/** 접두어로 무리를 가른다 — 별칭 `web` 과 빠른 접속(`adhoc`) `web` 이 같은 서버로 읽히지 않게 */
export function hostIdentity(pane: Pick<PaneSpec, "kind" | "alias" | "adhoc">): string | null {
  if (pane.kind !== "ssh") return null;
  if (pane.adhoc) {
    const host = pane.adhoc.host.trim().toLowerCase();
    if (host === "") return null;
    return `adhoc:${pane.adhoc.user ?? ""}@${host}:${pane.adhoc.port ?? 22}`;
  }
  const alias = pane.alias?.trim().toLowerCase();
  return alias ? `alias:${alias}` : null;
}

/** `sameWindow` = `fsDragActive() !== null` — 남의 창에서 온 원격 키는 무엇을 가리키는지 모른다(`fs-drag.ts` 의 `fsDragActive`) */
export function fsDropRoute(
  sourceKey: string,
  sameWindow: boolean,
  target: FsDropTarget,
  hostOfSession: (session: number) => string | null,
): FsDropRoute {
  if (sourceKey === LOCAL_KEY) return target.kind === "local" ? "same" : "upload";
  const source = sessionOfFsKey(sourceKey);
  if (source === null || !sameWindow) return "foreign";
  if (target.kind === "local") return "download";
  if (target.session !== null && source === target.session) return "same";
  const from = hostOfSession(source);
  return from !== null && target.host !== null && from === target.host ? "same" : "foreign";
}

export type FsDropAction =
  | { kind: "broadcast" }
  | { kind: "paste" }
  | { kind: "upload" }
  | { kind: "download" }
  | { kind: "notice"; key: Extract<Key, "pane.drop.fs.elsewhere" | "pane.drop.fs.otherserver"> };

export function fsDropAction(route: FsDropRoute, agent: boolean, targetKind: SessionKind): FsDropAction {
  if (!agent) return route === "same" ? { kind: "broadcast" } : { kind: "notice", key: "pane.drop.fs.elsewhere" };
  switch (route) {
    case "same":
      return { kind: "paste" };
    case "upload":
      return { kind: "upload" };
    case "download":
      return { kind: "download" };
    case "foreign":
      return {
        kind: "notice",
        key: targetKind === "ssh" ? "pane.drop.fs.otherserver" : "pane.drop.fs.elsewhere",
      };
  }
}
