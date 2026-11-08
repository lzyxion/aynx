/**
 * **파일 타일 → 터미널 타일 드롭의 판정** — 순수 함수 넷 (2026-10-07 사용자 결정).
 *
 * 파일 타일이 끄는 짐(`FsDrag`)에는 **어디서 왔는지**(`backendKey` — `"local"` · `"ssh:<세션>"`)가 실린다.
 * 놓는 터미널과 같은 곳의 파일이면 경로가 그대로 뜻이 있고, 다른 곳이면 그 경로는 그 터미널에서 없는 파일이다.
 *
 * | 출처 \ 놓는 곳 | AI 타일 | 일반 셸 |
 * | --- | --- | --- |
 * | 같은 곳 (`same`) | 경로를 괄호 붙여넣기(첨부) | 경로 입력(동시 입력 규칙 그대로) |
 * | 로컬 → 원격 (`upload`) | 그 서버로 사본을 올려 붙여넣기 | 안내만 |
 * | 원격 → 로컬 (`download`) | 로컬 첨부 폴더로 사본을 받아 붙여넣기 | 안내만 |
 * | 다른 서버 · 모름 (`foreign`) | 안내만 | 안내만 |
 *
 * **모르면 다른 곳이다** — 안내는 아무것도 망가뜨리지 않지만, 엉뚱한 경로를 붙이면 사람이 그걸 믿고 명령을 친다.
 * 세션 → 호스트 조회(창 안의 타일 표)는 `app/sessions.svelte.ts` 의 `hostOfSession` 이 하고, 여기는 그 답만 받는다.
 */
import { LOCAL_KEY } from "$lib/fs-backend";
import type { Key } from "$lib/i18n/keys";
import type { PaneSpec, SessionKind } from "$lib/session/spec";

export type FsDropRoute = "same" | "upload" | "download" | "foreign";

/** 놓는 터미널 타일 — 종류 · 지금 물고 있는 세션 · 붙은 호스트의 신원([`hostIdentity`]) */
export interface FsDropTarget {
  kind: SessionKind;
  session: number | null;
  host: string | null;
}

/** `"ssh:12"` → `12`. 로컬·세션 없음(`ssh:none`)·모르는 모양은 `null` */
export function sessionOfFsKey(key: string): number | null {
  const m = /^ssh:(\d+)$/.exec(key);
  return m ? Number(m[1]) : null;
}

/**
 * 원격 타일이 붙은 **서버의 신원** — 세션이 다른 두 타일이 같은 서버인지 비교하는 열쇠. 모르면 `null`.
 *
 * 빠른 접속 타일은 `alias` 가 설정의 별칭이 아니라 보이는 이름이고 진짜 대상은 `adhoc` 이다(`PaneSpec.adhoc`).
 * 두 무리가 섞이지 않게 접두어를 달아, 별칭 `web` 과 빠른 접속 `web` 이 같은 서버로 읽히지 않는다(모르면 다른 곳).
 */
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

/**
 * 짐의 출처가 놓는 타일과 **같은 곳인가**, 아니면 어느 쪽으로 다른가.
 *
 * `sameWindow` 는 이 드래그가 이 창에서 시작했는가(`fsDragActive() !== null`)다 — 원격 키의 세션 번호는 창마다
 * 도는 카운터라, 남의 창에서 온 `ssh:2` 는 여기서 무엇을 가리키는지 모른다(`fs-drag.ts` 의 `fsDragActive` 주석).
 * 로컬 키는 창을 넘어도 같은 뜻이다.
 */
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

/** 판정 → 할 일. 위 표 그대로 */
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
