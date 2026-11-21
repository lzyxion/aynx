/**
 * 타일 위 드롭의 판정 — 놓는 곳이 뜻을 정한다 (docs/log/2026-09-05-refactor-pane-host.md).
 * 수정키(`Ctrl`·`Shift`)는 보지 않는다 — 그 뜻은 파일 브라우저 안쪽 규칙(`fs-route.ts` 의 `dragMode`)이고 타일 위에서는 같은 드래그가 늘 같은 뜻이다.
 */

import { FS_DRAG_TYPE } from "$lib/fs-drag";
import type { FsDropRoute } from "$lib/fs-drop-route";
import { HOSTS_DRAG_TYPE } from "$lib/hosts";
import { ZONE_SPLIT, type DropZone } from "$lib/layout";
import {
  hasSession,
  PANE_DRAG_TYPE,
  TAB_DRAG_TYPE,
  type PaneKind,
  type PaneSide,
  type SplitDir,
  type Tr,
} from "$lib/session";
import { TEAR_DRAG_TYPE } from "$lib/tear";

/** `null` = 남의 것 — 손대지 않는다 */
export type DragKind = "hosts" | "fsfiles" | "tab" | "pane" | "files";

/**
 * 내부 종류(`x-aynx-*`)를 `"Files"` 보다 먼저 본다 — 내부 드래그에도 브라우저가 `"Files"` 를 끼워 넣는 경우가 있어 타일 이동이 업로드로 오해받는다.
 * `x-aynx-tear` 는 종류가 아니라 탭 · 타일 드래그에 덧실리는 표식이다([`isForeignDrag`]).
 */
export function dragKind(types: readonly string[] | undefined | null): DragKind | null {
  if (!types) return null;
  if (types.includes(HOSTS_DRAG_TYPE)) return "hosts";
  if (types.includes(FS_DRAG_TYPE)) return "fsfiles";
  if (types.includes(TAB_DRAG_TYPE)) return "tab";
  if (types.includes(PANE_DRAG_TYPE)) return "pane";
  if (types.includes("Files")) return "files";
  return null;
}

/**
 * `dragover` 용 추측 — 값을 못 읽으니 tear 표식 + 이 창의 드래그 표시가 비었는가로 본다(표시는 창마다 별개인 모듈 상태).
 * 확정은 놓는 순간의 `foreignTearToken` 이다.
 */
export function isForeignDrag(
  types: readonly string[] | undefined | null,
  kind: DragKind,
  dragging: { tab: string | null; pane: string | null },
): boolean {
  if (!types?.includes(TEAR_DRAG_TYPE)) return false;
  if (kind === "tab") return dragging.tab === null;
  if (kind === "pane") return dragging.pane === null;
  return false;
}

/** `none` 과 `yield` 는 결과가 같다 — `yield` 는 안쪽 화면에 드롭 대상이 있다는 뜻이라 나눠 둔다 */
export type DropOutcome =
  | "none"
  | "yield"
  | "open"
  | "move"
  | "merge"
  | "adopt"
  | "upload"
  | "attach"
  | "paste";

export interface DropPlan {
  outcome: DropOutcome;
  /** `dragover` 에서 `preventDefault` 를 부르는가 — 곧 "여기 놓아도 된다" 는 신호다 */
  accept: boolean;
  effect: "copy" | "move" | null;
  preview: "none" | "zone" | "all";
  split: { dir: SplitDir; side: PaneSide } | null;
}

/** 타일 위가 아니면(분할선 · 캔버스 여백) `kind` 가 `null` */
export interface DropTarget {
  kind: PaneKind | null;
  orch?: boolean;
  agent?: boolean;
  tabId: string;
  paneId: string;
}

/**
 * `dragover`(추측 · 모듈 상태)와 `drop`(확정 · `dataTransfer` 값)에서 같은 함수를 부른다 — 미리보기가 받아 준 드래그를 놓았을 때
 * 아무 일도 안 나는 어긋남이 생기지 않게.
 */
export interface DragCtx {
  kind: DragKind;
  foreign: boolean;
  /** 모르면 `null`·`""` — 무동작 */
  sourceTabId?: string | null;
  sourcePaneId?: string | null;
}

const NONE: DropPlan = { outcome: "none", accept: false, effect: null, preview: "none", split: null };
const YIELD: DropPlan = { ...NONE, outcome: "yield" };

/** 시작 타일은 미리보기가 상자 전체다 — 유일한 잎이면 분할이 아니라 교체(`placePane`)라 절반 미리보기는 일어나지 않을 일을 약속한다 */
function splitPlan(
  outcome: DropOutcome,
  effect: "copy" | "move",
  target: DropTarget,
  zone: DropZone,
): DropPlan {
  return {
    outcome,
    accept: true,
    effect,
    preview: target.kind === "start" ? "all" : "zone",
    split: ZONE_SPLIT[zone],
  };
}

export function dropPlan(drag: DragCtx, target: DropTarget, zone: DropZone): DropPlan {
  const k = target.kind;
  if (k === null) return NONE;
  // 오케스트레이션 탭은 배치가 고정이다 — 타일 안으로 넣는 것(OS 파일 · 파일 짐)만 받는다
  if (target.orch === true && drag.kind !== "files" && drag.kind !== "fsfiles") return NONE;

  switch (drag.kind) {
    case "hosts":
      return splitPlan("open", "copy", target, zone);

    case "files":
      // 쿼리 타일은 놓인 `.sql` 을 새 스크립트 탭으로 스스로 받는다(`QueryView`)
      if (k === "query") return YIELD;
      return {
        outcome: hasSession(k) && target.agent ? "attach" : "upload",
        accept: true, effect: "copy", preview: "all", split: null,
      };

    // 터미널에 붙여넣는다(실행하지 않는다)
    case "fsfiles":
      if (hasSession(k)) {
        return { outcome: "paste", accept: true, effect: "copy", preview: "all", split: null };
      }
      return k === "sftp" || k === "localfs" || k === "query" ? YIELD : NONE;

    // 창을 넘어온 것은 id 검사를 지나지 않는다 — 탭 카운터가 창마다 따로 돌아 남의 `tab-1` 이 내 `tab-1` 과 글자가 같다
    case "tab": {
      if (drag.foreign) return splitPlan("adopt", "move", target, zone);
      const src = drag.sourceTabId ?? null;
      if (src === null || src === "" || src === target.tabId) return NONE;
      return splitPlan("merge", "move", target, zone);
    }

    case "pane": {
      if (drag.foreign) return splitPlan("adopt", "move", target, zone);
      const src = drag.sourcePaneId ?? null;
      if (src === null || src === "" || src === target.paneId) return NONE;
      return splitPlan("move", "move", target, zone);
    }
  }
}

export type DropLabelKind = "upload" | "paste" | "attach" | "paste.elsewhere" | "attach.otherserver";

/** `route` 가 `null`(남의 창 드래그 — `dragover` 에서 출처를 못 읽는다)이면 기본 문구 — 놓는 순간 다시 판정한다 */
export function fsPasteLabel(route: FsDropRoute | null, agent: boolean): DropLabelKind {
  if (agent) return route === "foreign" ? "attach.otherserver" : "attach";
  return route === null || route === "same" ? "paste" : "paste.elsewhere";
}

/** `remoteWindow` — 원격 창에서 로컬 타일(메인 PC 디스크)에 놓으면 그 기기의 파일이 올라가는 것이라 SFTP 와 같은 말이다 */
export function dropLabel(outcome: DropLabelKind, kind: PaneKind, tr: Tr, remoteWindow = false): string {
  if (outcome === "attach") return tr("pane.drop.attach");
  if (outcome === "attach.otherserver") return tr("pane.drop.attach.otherserver");
  if (outcome === "paste") return tr("pane.drop.paste");
  if (outcome === "paste.elsewhere") return tr("pane.drop.paste.elsewhere");
  if (kind === "ssh") return tr("pane.drop.upload.ssh");
  if (kind === "sftp" || (kind === "localfs" && remoteWindow)) return tr("pane.drop.upload.sftp");
  if (kind === "localfs") return tr("pane.drop.upload.localfs");
  return tr("pane.drop.upload.none");
}
