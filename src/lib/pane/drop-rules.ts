/**
 * **타일 위 드롭의 판정** — 순수 함수 셋 (docs/log/2026-09-05-refactor-pane-host.md).
 *
 * `PaneHost` 의 `dragover`/`drop` 이 하던 판정을 그대로 옮겨 놓은 것이다. 옮긴 이유는
 * 하나다 — 이 판정은 **표**인데, 표가 이벤트 핸들러 안에 흩어져 있으면 표로 읽히지 않는다.
 * 규칙은 네 개의 로그에 나뉘어 적혀 있고(아래 표), 그중 어느 칸이 지금 코드와 어긋나
 * 있는지는 화면을 띄워 여덟 가지 드래그를 직접 해 봐야만 알 수 있었다.
 *
 * ## 판정 표 (놓는 곳이 뜻을 정한다)
 *
 * | 드래그 \ 놓는 곳 | 터미널(ssh·local) | 파일 타일(sftp·localfs) | 시작 |
 * | --- | --- | --- | --- |
 * | 호스트·폴더 (`hosts`) | 열기 (4분면) | 열기 | 열기 (미리보기 = 상자 전체) |
 * | 탭 (`tab`) | 병합 | 병합 | 병합 |
 * | 타일 (`pane`) | 이동 | 이동 | 이동 |
 * | 다른 창의 탭·타일 (`+tear`) | 합치기 | 합치기 | 합치기 |
 * | OS 파일 (`files`) | AI CLI = 첨부, 그 밖 = 업로드 (상자 전체) | 업로드 | 업로드¹ |
 * | 파일 짐 (`fsfiles`) | 경로 붙여넣기² | **양보** — 브라우저가 받는다 | 무동작 |
 *
 * **호스트·폴더 드래그의 출처는 이제 독뿐이다** (`Dock.svelte`) — 그 층은 타일 위에 떠
 * 있으므로 "놓는 곳" 이 될 수 없고, 표에서 `kind:"hosts"` 칸(트리가 정리로 받던 **양보**)이
 * 그래서 사라졌다 (docs/log/2026-09-08-remove-hosts-tile.md). 독 **안**에 놓는 정리(그룹
 * 이동·중첩)는 트리 자신의 드롭 대상이 받고 이 층에는 닿지 않는다.
 *
 * ¹ 받기는 받고 상위가 문구로 거절한다 — 오버레이에 "SSH 타일에만 업로드할 수 있습니다"
 * 가 뜬다 ([`dropLabel`]). 커서 아래에 아무 타일도 없으면(분할선 위) 전부 무동작이다.
 *
 * ² 무엇을 붙이는지는 짐의 출처와 놓는 타일이 정한다 — 같은 곳이면 경로 그대로(AI 타일은 괄호 붙여넣기), 다른 곳이면
 * AI 타일에는 사본 경로·셸에는 안내 (`fs-drop-route.ts` 의 표 · 문구는 [`fsPasteLabel`]).
 *
 * 근거 로그: docs/log/2026-09-04-hosts-multiselect.md(열기) · 2026-09-04-fs-multiselect-clipboard.md
 * (붙여넣기·업로드) · 2026-09-04-tear-merge-fixes.md(창을 넘는 합치기).
 *
 * ## 왜 수정키(`Ctrl`·`Shift`)를 보지 않는가
 *
 * 이 층에는 수정키의 뜻이 없다. `Ctrl` = 복사도 `Shift` = 이동도 **파일 브라우저 안쪽**의
 * 규칙이고 (`fs-route.ts` 의 `dragMode` — 계층 기본값을 정하는 `sameTier` 를 그것이 감싼다),
 * 타일 위에서는 같은 드래그가 언제나 같은 뜻이다 —
 * 타일을 옮기는 것은 이동, 호스트를 여는 것은 복사. 그래서 인자로 받지 않는다:
 * 받아 두면 "언젠가 쓰겠지" 로 남고, 안 쓰는 인자는 표를 읽는 사람을 헷갈리게 한다.
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

/** 우리가 아는 드래그의 종류 (`null` = 남의 것 — 손대지 않는다) */
export type DragKind = "hosts" | "fsfiles" | "tab" | "pane" | "files";

/**
 * 이 드래그가 우리 것인가 — `dragover` 에서는 값을 못 읽고 **종류만** 볼 수 있다.
 *
 * 내부 종류(`x-aynx-*`)를 **먼저** 본다. 파일 판정(`"Files"`)이 앞에 오면 안 된다 —
 * 내부 드래그에도 브라우저가 `"Files"` 를 끼워 넣는 경우가 있어서(플랫폼마다 다르다)
 * 패널 이동이 업로드로 오해받을 수 있다. 우리 타입이 하나라도 있으면 그것이 진짜다.
 *
 * **`x-aynx-tear` 는 종류가 아니다.** 그것은 탭·타일 드래그에 *덧실리는* 표식이라
 * (창을 넘을 수 있다는 뜻), 같은 드래그가 `"tab"` 이면서 tear 를 함께 싣는다.
 * 그래서 이 목록에 넣지 않고 [`isForeignDrag`] 가 따로 묻는다.
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
 * 이 탭·타일 드래그가 **다른 창에서 왔는가** (`dragover` 판정용).
 *
 * `dragover` 에서는 `dataTransfer` 의 값을 읽을 수 없으므로 두 가지를 겹쳐 묻는다:
 * ①`x-aynx-tear` 가 실려 있는가(= 창을 넘길 수 있는 드래그인가) ②이 창의 드래그 표시가
 * 비었는가. 표시(`draggingTab`/`draggingPane`)는 창마다 별개인 모듈 상태라 남의 창에서
 * 시작한 드래그에서는 언제나 비어 있다.
 *
 * 번호를 읽어 "정말 남의 것인가" 를 확인하는 것은 놓는 순간이다 (`foreignTearToken`) —
 * 여기서는 미리보기를 그릴지만 정하므로 이 정도면 충분하고, 어긋나도 놓을 때 갈린다.
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

/**
 * 놓았을 때 **무슨 일이 일어나는가**.
 *
 * `none` 과 `yield` 는 결과가 같다(이 층이 `preventDefault` 를 부르지 않는다). 그래도
 * 나눠 두는 이유는 **뜻이 다르기 때문**이다: `yield` 는 "안쪽 화면이 이 드래그를 받는다"
 * 라 그 자리에 드롭 대상이 **있고**(호스트 트리의 그룹 머리글, 파일 목록의 폴더 줄),
 * `none` 은 놓을 자리가 아예 없다는 뜻이다. 한 칸으로 합치면 표에서 그 차이가 사라진다.
 */
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
  /** `dragover` 에서 `preventDefault` 를 부르는가 — 그것이 곧 "여기 놓아도 된다" 는 신호다 */
  accept: boolean;
  /** 커서 모양 (`accept` 일 때만 뜻이 있다) */
  effect: "copy" | "move" | null;
  /** 미리보기 — 4분면 절반(`zone`) · 상자 전체(`all`) · 없음 */
  preview: "none" | "zone" | "all";
  /** 넣을 자리 (`ZONE_SPLIT`). 나누는 조작이 아니면 `null` */
  split: { dir: SplitDir; side: PaneSide } | null;
}

/** 커서 아래 자리 — 타일 위가 아니면 `kind` 가 `null` 이다 (분할선·캔버스 여백) */
export interface DropTarget {
  kind: PaneKind | null;
  /** 놓는 타일이 오케스트레이션 탭에 있는가(2026-10-29 — D11: 배치를 바꾸는 드롭은 받지 않는다) */
  orch?: boolean;
  /** 지금 AI CLI가 실행 중인 터미널인가 (타일 신원과 같은 판정) */
  agent?: boolean;
  tabId: string;
  paneId: string;
}

/**
 * 드래그 쪽 사정. `foreign` 과 `source*` 는 **판정하는 시점마다 값이 다르다**:
 *
 * | | `dragover` | `drop` |
 * | --- | --- | --- |
 * | `foreign` | [`isForeignDrag`] 의 추측 | `foreignTearToken() !== null` (확정) |
 * | `sourceTabId`·`sourcePaneId` | `draggingTab()`·`draggingPane()` (모듈 상태) | `dataTransfer` 에서 읽은 값 |
 *
 * 같은 함수를 두 시점에 부르는 것이 요점이다 — 미리보기가 받아 준 드래그를 놓았을 때
 * 아무 일도 안 나는 어긋남이 여기서는 생길 수 없다.
 */
export interface DragCtx {
  kind: DragKind;
  foreign: boolean;
  /** 끌고 있는 탭 id (`kind:"tab"`). 모르면 `null`·`""` — 그때는 무동작이다 */
  sourceTabId?: string | null;
  /** 끌고 있는 타일 id (`kind:"pane"`). 〃 */
  sourcePaneId?: string | null;
}

const NONE: DropPlan = { outcome: "none", accept: false, effect: null, preview: "none", split: null };
const YIELD: DropPlan = { ...NONE, outcome: "yield" };

/**
 * 4분면에 넣는 조작들의 공통 모양.
 *
 * **시작 타일만 미리보기가 상자 전체**다 (docs/log/2026-09-04-start-page.md): 시작 타일이
 * 탭의 유일한 잎일 때 무엇을 놓든 분할이 아니라 **교체**이므로(`placePane`),
 * 절반만 덮는 미리보기는 일어나지 않을 일을 약속하는 셈이 된다. 넣는 자리(`split`)는
 * 그대로 넘긴다 — 잎이 여럿이면 4분면이 그대로 뜻을 갖는다.
 */
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

/**
 * **판정 한 곳** — 위 표를 그대로 코드로 옮긴 것이다.
 *
 * `zone` 은 커서 위치가 정한 4분면(`zoneOf`)이고, 나누는 조작이 아닌 결과에서는 쓰이지
 * 않는다 (업로드·붙여넣기는 타일을 나누는 조작이 아니라 그 타일 **안으로** 무언가를 넣는
 * 조작이라, 절반을 덮는 미리보기는 거짓말이 된다).
 */
export function dropPlan(drag: DragCtx, target: DropTarget, zone: DropZone): DropPlan {
  const k = target.kind;
  if (k === null) return NONE; // 타일 위가 아니다
  // 오케스트레이션 탭은 배치가 고정이다(D11) — 타일을 나누거나 옮기는 드롭(호스트 열기 · 탭 병합 · 타일 이동 · 창 넘기기)은 받지 않는다.
  // 그 타일 **안으로** 넣는 것(OS 파일 첨부 · 파일 짐 붙여넣기)은 그대로다.
  if (target.orch === true && drag.kind !== "files" && drag.kind !== "fsfiles") return NONE;

  switch (drag.kind) {
    // 호스트·폴더 — **여는** 조작이라 `copy` (독의 트리에서 사라지지 않는다).
    // 예외가 없다: 트리를 담는 독은 타일 위에 뜬 층이라 놓는 곳이 되지 않는다.
    case "hosts":
      return splitPlan("open", "copy", target, zone);

    // OS 파일 — AI CLI 입력창에 첨부하거나, 그 타일의 서버·폴더로 업로드한다.
    case "files":
      return {
        outcome: hasSession(k) && target.agent ? "attach" : "upload",
        accept: true, effect: "copy", preview: "all", split: null,
      };

    // 파일 타일에서 끌어온 경로 묶음 — 터미널에 **붙여넣는다**(실행하지 않는다).
    // 다른 파일 타일 위에서는 그 브라우저가 자기 폴더 줄·빈 바닥에서 받는다.
    case "fsfiles":
      if (hasSession(k)) {
        return { outcome: "paste", accept: true, effect: "copy", preview: "all", split: null };
      }
      return k === "sftp" || k === "localfs" ? YIELD : NONE;

    // 탭 통째로 — 그 자리에 병합. **자기 자신 위는 무시한다**(트리를 제 안에
    // 넣는 꼴이다). 창을 넘어온 것은 이 검사를 지나지 않는다: 남의 `tab-1` 은 내 `tab-1`
    // 과 다른 탭인데 글자가 같아서(카운터가 창마다 따로 돈다) 애먼 드랍이 막힌다.
    case "tab": {
      if (drag.foreign) return splitPlan("adopt", "move", target, zone);
      const src = drag.sourceTabId ?? null;
      if (src === null || src === "" || src === target.tabId) return NONE;
      return splitPlan("merge", "move", target, zone);
    }

    // 타일 하나 — 트리에서 떼어 그 자리로. 제자리는 무시한다 (떼서 같은 자리에 다시
    // 넣는 꼴이라 할 일이 없다).
    case "pane": {
      if (drag.foreign) return splitPlan("adopt", "move", target, zone);
      const src = drag.sourcePaneId ?? null;
      if (src === null || src === "" || src === target.paneId) return NONE;
      return splitPlan("move", "move", target, zone);
    }
  }
}

/**
 * 오버레이 문구의 종류 — 판정 결과(`upload`·`paste`·`attach`)에 파일 타일 짐의 두 갈래를 더한 것.
 * 파일 타일 짐은 판정이 언제나 `paste` 인데, 놓는 타일과 짐의 출처에 따라 실제로 일어나는 일이 달라진다
 * ([`fsPasteLabel`]).
 */
export type DropLabelKind = "upload" | "paste" | "attach" | "paste.elsewhere" | "attach.otherserver";

/**
 * 파일 타일 짐(`fsfiles`)을 터미널에 놓을 때의 문구 — `fs-drop-route.ts` 의 표를 말로 옮긴다.
 * `route` 가 `null` 이면(남의 창에서 온 드래그라 `dragover` 에서 출처를 못 읽는다) 예전 문구 그대로다 — 놓는 순간
 * 짐을 펴서 다시 판정하고, 안 되는 일이면 안내가 뜬다.
 */
export function fsPasteLabel(route: FsDropRoute | null, agent: boolean): DropLabelKind {
  if (agent) return route === "foreign" ? "attach.otherserver" : "attach";
  return route === null || route === "same" ? "paste" : "paste.elsewhere";
}

/**
 * 상자를 통째로 덮는 오버레이에 적는 말 — **무슨 일이 일어나는지**를 놓기 전에 말한다.
 *
 * SFTP·로컬 타일은 **보고 있는 폴더**가 목적지다 — 그것이 브라우저를 여는 이유의 절반이다
 * (SSH 터미널에 놓으면 홈으로 가고, 파일 타일에 놓으면 지금 그 자리로 간다).
 * 마지막 줄은 거절이다: 시작 타일과 로컬 셸에는 올릴 원격이 없다.
 */
export function dropLabel(outcome: DropLabelKind, kind: PaneKind, tr: Tr): string {
  if (outcome === "attach") return tr("pane.drop.attach");
  if (outcome === "attach.otherserver") return tr("pane.drop.attach.otherserver");
  if (outcome === "paste") return tr("pane.drop.paste");
  if (outcome === "paste.elsewhere") return tr("pane.drop.paste.elsewhere");
  if (kind === "ssh") return tr("pane.drop.upload.ssh");
  if (kind === "sftp") return tr("pane.drop.upload.sftp");
  if (kind === "localfs") return tr("pane.drop.upload.localfs");
  return tr("pane.drop.upload.none");
}
