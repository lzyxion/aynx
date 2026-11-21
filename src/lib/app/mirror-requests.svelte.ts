import { Channel, invoke, isRemote } from "../ipc";
import { askConfirm } from "$lib/app/confirm-dialog.svelte.js";
import { isMainWindow } from "$lib/app/window.svelte.js";
import { showNotice } from "$lib/app/notice";
import { t } from "$lib/i18n/i18n.svelte.js";
import { isDocDirty } from "$lib/app/doc-dirty.svelte.js";
import { hasOpenDbTx } from "$lib/app/db-tx";
import { confirmUnsavedClose } from "$lib/app/unsaved-docs";
import {
  activeTabId, adoptPane, autoDirFor, closePaneIn, closeTab, currentWorkspaceTabs, docNameOf, focusPane, isLoneStart,
  mergeTab, movePane, moveTile, openInNewTab, openPaneHere, openPaneInTab, openTab, openTabInWorkspace, placePane, promotePane, renameTab, resizeTile,
  reorderTabs, replaceTile, residentWindowTabs, selectTab, setRemoteLayoutSink, splitActive,
} from "$lib/app/tabs.svelte.js";
import { closeOwnInstance, homeTabKey, homeTileKey, isOwnInstance, mirrorSource } from "$lib/app/mirror.svelte.js";
import { currentWorkspaceId, workspaceList } from "$lib/app/workspaces.svelte.js";
import { openOrchTabForRemote } from "$lib/app/orchestration.svelte.js";
import { applyFileUiChange } from "$lib/app/panes.svelte.js";
import {
  findPane, hasSession, leafOf, listPanes, newStartPane, newTab, nextHistoryStreamId, type PaneSpec, type TabSpec,
} from "$lib/session";
import {
  anyWorkspace, findTabByKey, findTileByKey, homePane, isClosing, parseLayoutRequest, refusalOf, toWire, type LayoutRequest, type Refusal,
} from "$lib/mirror/request";

/**
 * 원격 창: 세션을 끝내는 닫기 · 원격 창 자신의 저장 안 한 문서가 든 닫기는 보내기 전에 여기서 묻는다(행동한 사람이 확인한다).
 * 메인 PC 주 창: 원격 창이 들을 수 있는 이벤트가 아니라 GUI 가 주 창에만 여는 채널(`mirror_request_inbox`)로 받는다.
 * 닫기는 확인 창 없이 적용하되 저장 안 한 문서 · 열린 DB 트랜잭션이면 거절한다.
 */

// ---------------------------------------------------------------------------
// 원격 창 — 보내기
// ---------------------------------------------------------------------------

function refuseText(r: Refusal): string {
  return t(`app.mirror.refuse.${r}`);
}

function sessionTilesIn(paneIds: readonly string[]): number {
  return paneIds.filter((id) => {
    for (const tab of residentWindowTabs()) {
      const p = findPane(tab.root, id);
      if (p) return hasSession(p.kind);
    }
    return false;
  }).length;
}

/** 메인 PC 쪽 저장 안 한 문서 · 열린 트랜잭션은 메인 PC 가 거절한다 — 여기서는 이 창의 것만 묻는다 */
async function confirmClose(req: Extract<LayoutRequest, { op: "closeTile" | "closeTabs" }>): Promise<boolean> {
  const panes =
    req.op === "closeTile"
      ? [req.tile]
      : residentWindowTabs()
          .filter((tab) => req.tabs.includes(tab.id))
          .flatMap((tab) => listPanes(tab.root).map((p) => p.id));
  const dirty = panes.filter(isDocDirty);
  if (dirty.length > 0 && !(await confirmUnsavedClose(dirty, docNameOf))) return false;
  const sessions = sessionTilesIn(panes);
  if (sessions === 0) return true;
  const body =
    req.op === "closeTile"
      ? t("app.mirror.confirmCloseTile")
      : t("app.mirror.confirmCloseTabs", { tabs: req.tabs.length, sessions });
  try {
    return await askConfirm(body, { title: t("app.mirror.confirmTitle"), kind: "warning", danger: true });
  } catch {
    return false;
  }
}

/** 조용히 실패한다(토글마다 안내가 쌓이지 않게) — 메인 PC 가 못 받으면 다음 거울 갱신에 되돌아간다(알고 받은 한계 · docs/log/2026-11-04-file-ui-keep.md) */
async function sendFileUi(req: Extract<LayoutRequest, { op: "fileUi" }>): Promise<void> {
  if (mirrorSource() !== "home") return;
  const wire = toWire(req, { tile: homeTileKey, tab: homeTabKey });
  if (!wire) return;
  await invoke("mirror_request", { request: wire }).catch(() => {});
}

async function sendLayout(req: LayoutRequest): Promise<void> {
  if (req.op === "fileUi") return sendFileUi(req);
  // 원격에서 따로 연 제 타일 — 메인 PC 에는 없는 타일이라 원격 혼자 닫는다.
  if (req.op === "closeTile" && isOwnInstance(req.tile)) {
    closeOwnInstance(req.tile);
    return;
  }
  if (mirrorSource() !== "home") {
    showNotice(refuseText("no-home"));
    return;
  }
  const wire = toWire(req, { tile: homeTileKey, tab: homeTabKey });
  if (!wire) {
    showNotice(refuseText("missing"));
    return;
  }
  if (isClosing(req) && !(await confirmClose(req))) return;
  try {
    await invoke("mirror_request", { request: wire });
  } catch (e) {
    const r = refusalOf(e);
    showNotice(r ? refuseText(r) : t("app.mirror.refuse.other", { error: String(e) }));
  }
}

export function startRemoteLayoutRequests(): void {
  if (!isRemote) return;
  setRemoteLayoutSink((req) => void sendLayout(req));
}

// ---------------------------------------------------------------------------
// 메인 PC 주 창 — 받아 적용하기
// ---------------------------------------------------------------------------

const fail = (r: Refusal, why = ""): string => `[mirror-${r}]${why ? ` ${why}` : ""}`;

/** 키보드 포커스는 옮기지 않는다 — `focusTile` 은 다음 프레임에 DOM 포커스를 되돌려 방금 연 새 타일의 포커스를 빼앗는다 */
function aim(tabId: string, paneId: string): void {
  if (activeTabId() !== tabId) selectTab(tabId);
  focusPane(tabId, paneId);
}

function tabById(id: string): TabSpec | null {
  return residentWindowTabs().find((tab) => tab.id === id) ?? null;
}

/**
 * 거절 글자 `[mirror-<사유>]` 는 원격이 사람 말로 바꾼다. 대상은 지금 워크스페이스에서만 찾는다 — 다른 워크스페이스의 대상이면 화면이
 * 그리로 옮겨 가므로 `elsewhere` 로 거절한다(화면을 옮기지 않는 닫기 · 이름 바꾸기만 모든 워크스페이스).
 */
export function applyLayoutRequest(req: LayoutRequest, device: string): string | null {
  const tabs = currentWorkspaceTabs();
  const everywhere = residentWindowTabs();
  const scope = anyWorkspace(req) ? everywhere : tabs;
  const tile = (key: string) => findTileByKey(scope, key);
  const tab = (key: string) => findTabByKey(scope, key);
  const elsewhere = (key: string) => findTileByKey(everywhere, key) !== null || findTabByKey(everywhere, key) !== null;
  const lost = (...keys: (string | null | undefined)[]): string =>
    keys.some((k) => typeof k === "string" && elsewhere(k)) ? fail("elsewhere") : fail("missing");
  const fresh = (p: PaneSpec): PaneSpec => {
    const pane = homePane(p, newStartPane().id, (key) => tile(key)?.paneId ?? null);
    // 터미널은 이 창이 새 스트림 열쇠를 단다 — 없으면 스트림이 메인 PC 의 pane id 가 되어 원격(다른 id)이 시청할 열쇠를 모른다.
    if (hasSession(pane.kind)) pane.historyStreamId = nextHistoryStreamId();
    return pane;
  };
  switch (req.op) {
    case "newTab": {
      if (req.workspace !== undefined && req.workspace !== currentWorkspaceId()) {
        const t0 = newTab();
        const pane = req.pane ? fresh(req.pane) : null;
        if (req.title) {
          t0.title = req.title;
          if (pane) t0.pinnedTitle = req.title;
        }
        if (pane && req.projectId) t0.projectId = req.projectId;
        if (pane && req.projectFolder?.trim()) t0.projectFolder = req.projectFolder.trim();
        if (openTabInWorkspace(req.workspace, t0, pane)) return null;
        return workspaceList().some((w) => w.id === req.workspace) ? fail("cold") : fail("missing");
      }
      if (req.pane) {
        openInNewTab(fresh(req.pane), req.title, req.projectFolder, req.projectId);
      } else {
        const t0 = openTab(newTab());
        if (req.title) t0.title = req.title;
      }
      return null;
    }
    case "openPane": {
      if (req.tab === undefined) {
        openPaneHere(fresh(req.pane), req.title, req.projectId);
        return null;
      }
      const id = tab(req.tab);
      const spec = id ? tabById(id) : null;
      if (!id || !spec) return lost(req.tab);
      if (isLoneStart(spec)) {
        if (req.title) spec.title = req.title;
        if (req.projectId) spec.projectId = req.projectId;
      }
      const near = req.near !== undefined ? tile(req.near) : null;
      openPaneInTab(id, fresh(req.pane), near && near.tabId === id ? near.paneId : undefined);
      return null;
    }
    case "openBeside": {
      const at = tile(req.tile);
      const spec = at ? tabById(at.tabId) : null;
      if (!at || !spec) return lost(req.tile);
      const pane = fresh(req.pane);
      placePane(spec, leafOf(pane), at.paneId, req.dir ?? autoDirFor(spec, at.paneId), req.side ?? "after");
      adoptPane(spec.id, pane.id);
      focusPane(spec.id, pane.id);
      selectTab(spec.id);
      return null;
    }
    case "replaceTile": {
      const at = tile(req.tile);
      if (!at) return lost(req.tile);
      return replaceTile(at.tabId, at.paneId, fresh(req.pane), req.title) ? null : fail("unsaved");
    }
    case "split":
    case "tmuxTile": {
      const at = tile(req.tile);
      const spec = at ? tabById(at.tabId) : null;
      const src = at && spec ? findPane(spec.root, at.paneId) : null;
      if (!at || !src) return lost(req.tile);
      if (src.kind === "start") return fail("start");
      aim(at.tabId, at.paneId);
      if (req.op === "tmuxTile") {
        const name = req.name;
        splitActive(undefined, (fresh) => {
          if (name !== null) fresh.tmux = name;
        });
      } else splitActive(req.dir);
      return null;
    }
    case "closeTile": {
      const at = tile(req.tile);
      if (!at) return fail("missing");
      if (isDocDirty(at.paneId)) return fail("unsaved");
      if (hasOpenDbTx(at.paneId)) return fail("dbtx");
      closePaneIn(at.tabId, at.paneId);
      showNotice(t("app.mirror.closedTile", { device: device || t("app.mirror.someDevice") }));
      return null;
    }
    case "closeTabs": {
      const ids = req.tabs.map(tab).filter((id): id is string => id !== null);
      if (ids.length === 0) return fail("missing");
      const panes = ids.flatMap((id) => {
        const spec = tabById(id);
        return spec ? listPanes(spec.root).map((p) => p.id) : [];
      });
      if (panes.some(isDocDirty)) return fail("unsaved");
      if (panes.some(hasOpenDbTx)) return fail("dbtx");
      for (const id of ids) closeTab(id);
      showNotice(t("app.mirror.closedTabs", { device: device || t("app.mirror.someDevice"), count: ids.length }));
      return null;
    }
    case "renameTab": {
      const id = tab(req.tab);
      if (!id) return fail("missing");
      renameTab(id, req.name);
      return null;
    }
    case "reorderTab": {
      const id = tab(req.tab);
      const before = req.before === null ? null : tab(req.before);
      if (!id || (req.before !== null && !before)) return lost(req.tab, req.before);
      reorderTabs(id, before);
      return null;
    }
    case "moveTile": {
      const from = tile(req.tile);
      const to = tile(req.target);
      if (!from || !to) return lost(req.tile, req.target);
      movePane(from.paneId, to.paneId, req.dir, req.side, { stay: req.stay === true });
      return null;
    }
    case "promoteTile": {
      const from = tile(req.tile);
      const before = req.before === null ? null : tab(req.before);
      if (!from || (req.before !== null && !before)) return lost(req.tile, req.before);
      promotePane(from.paneId, before);
      return null;
    }
    case "mergeTab": {
      const id = tab(req.tab);
      const to = tile(req.target);
      if (!id || !to) return lost(req.tab, req.target);
      mergeTab(id, to.paneId, req.dir, req.side);
      return null;
    }
    case "swapTile":
    case "expandTile": {
      const at = tile(req.tile);
      if (!at) return lost(req.tile);
      aim(at.tabId, at.paneId);
      if (req.op === "swapTile") moveTile(req.dir);
      else resizeTile(req.dir);
      return null;
    }
    case "openOrchTab": {
      // 탭만 연다 — 앨범을 열지는 않는다
      const r = openOrchTabForRemote(req.runId ?? null, req.workspace ?? null);
      return r === "ok" ? null : fail(r);
    }
    case "fileUi": {
      const at = tile(req.tile);
      if (!at) return fail("missing");
      // 적기만 한다 — 마지막 값(`app/file-ui-last`)은 기기별이라 원격의 고름이 이 창의 새 타일을 바꾸지 않는다
      const { op: _op, tile: _tile, ...change } = req;
      return applyFileUiChange(at.paneId, change) ? null : fail("missing");
    }
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

async function handle(msg: unknown): Promise<void> {
  if (!isObj(msg) || typeof msg.id !== "number") return;
  const device = typeof msg.device === "string" ? msg.device : "";
  const req = parseLayoutRequest(msg.request);
  let error: string | null;
  try {
    error = req ? applyLayoutRequest(req, device) : fail("invalid");
  } catch (e) {
    console.warn("[aynx] 원격 배치 요청을 적용하지 못했습니다:", e);
    error = fail("invalid", String(e).slice(0, 120));
  }
  await invoke("mirror_respond", { id: msg.id, error }).catch(() => {});
}

export async function startMirrorRequests(): Promise<void> {
  if (!isMainWindow) return;
  const channel = new Channel<unknown>();
  channel.onmessage = (msg) => void handle(msg);
  await invoke("mirror_request_inbox", { channel }).catch((e: unknown) => {
    console.warn("[aynx] 원격 배치 요청 채널을 열지 못했습니다:", e);
  });
}
