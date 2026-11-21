import { openUrl } from "@tauri-apps/plugin-opener";
import { showNotice } from "$lib/app/notice";
import { sessionOf } from "$lib/app/sessions.svelte.js";
import { residentWindowTabs } from "$lib/app/tabs.svelte.js";
import { stripReason } from "$lib/error-reason";
import {
  addForward,
  diffForwardPresets,
  forwardBindKey,
  forwardKindOf,
  isAppForward,
  listForwards,
  removeForward,
  sameForwardTarget,
  userForwards,
  type ForwardInfo,
  type ForwardPreset,
} from "$lib/forward";
import { getHostMeta } from "$lib/hosts";
import { t } from "$lib/i18n/i18n.svelte.js";
import { listPanes, usesHostAlias, type PaneSpec } from "$lib/session";

/**
 * 타일별로 살아 있는 포워드 표와, 호스트 프리셋을 세션에 반영하는 두 길 (docs/log/2026-09-17-forward-presets.md).
 * 두 길(접속 직후 · 폼 저장 뒤)의 몸통은 `openOn` 하나다 — 갈리면 "접속하면 열리는데 저장하면 안 열리는 줄" 이 생긴다.
 */

/** 앱이 건 포워드(에이전트 신호)는 이 표에 들어오지 않는다 — 적는 자리가 모두 `userForwards` 를 거친다 */
const paneForwards = $state<Record<string, ForwardInfo[]>>({});

const CHIP_POLL_MS = 5000;

/** 타일마다 걸지 않는 타이머 하나 — 표가 비면 사라진다 */
let chipTimer: ReturnType<typeof setInterval> | null = null;

function syncChipTimer(): void {
  const live = Object.values(paneForwards).some((list) => list.length > 0);
  if (live && chipTimer === null) {
    chipTimer = setInterval(() => void pollActive(), CHIP_POLL_MS);
  } else if (!live && chipTimer !== null) {
    clearInterval(chipTimer);
    chipTimer = null;
  }
}

/**
 * 연결 수(`active_conns`)는 프런트를 지나지 않아 이 한 바퀴로만 안다.
 * 세션 id 가 없는 타일의 표는 지우지 않는다 — 지우면 재접속 직전에 칩이 깜빡 사라진다.
 */
async function pollActive(): Promise<void> {
  for (const [paneId, list] of Object.entries(paneForwards)) {
    if (list.length === 0) continue;
    const sid = sessionOf(paneId);
    if (sid === null) continue;
    const next = userForwards(await listForwards(sid));
    if (!sameForwards(list, next)) paneForwards[paneId] = next;
  }
  syncChipTimer();
}

function sameForwards(a: ForwardInfo[], b: ForwardInfo[]): boolean {
  return (
    a.length === b.length &&
    a.every((f, i) => {
      const g = b[i];
      return (
        f.id === g.id &&
        f.kind === g.kind &&
        f.local_port === g.local_port &&
        f.remote_port === g.remote_port &&
        f.remote_host === g.remote_host &&
        f.active_conns === g.active_conns
      );
    })
  );
}

export function forwardsOf(paneId: string): ForwardInfo[] {
  return paneForwards[paneId] ?? [];
}

export function setPaneForwards(paneId: string, list: ForwardInfo[]): void {
  paneForwards[paneId] = userForwards(list);
  syncChipTimer();
}

/** 그 세션의 포워드는 백엔드가 이미 거뒀다 (`close_ssh`) */
export function clearPaneForwards(paneId: string): void {
  delete paneForwards[paneId];
  syncChipTimer();
}

async function refreshPaneForwards(paneId: string, sessionId: number): Promise<void> {
  paneForwards[paneId] = userForwards(await listForwards(sessionId));
  syncChipTimer();
}

// ── 머리줄 포워딩 칩의 목록 메뉴 ──

export async function reloadPaneForwards(paneId: string): Promise<void> {
  const sid = sessionOf(paneId);
  if (sid === null) return;
  await refreshPaneForwards(paneId, sid);
}

/** 이미 사라진 id 도 성공이다(백엔드가 멱등) */
export async function stopPaneForward(paneId: string, id: number): Promise<void> {
  try {
    await removeForward(id, t);
  } catch (e) {
    showNotice(e instanceof Error ? e.message : String(e));
  }
  await reloadPaneForwards(paneId);
}

/** 시스템 기본 브라우저로 — 웹뷰 안에서 열면 돌아올 길이 없다 (docs/log/2026-09-27-forward-open-browser.md) */
export function openForwardUrl(url: string): void {
  void openUrl(url).catch((e: unknown) => {
    console.error(`[aynx] 포워드를 브라우저로 열지 못했습니다: ${url}`, e);
    showNotice(t("app.forward.open.failed", { url }));
  });
}

/** 원격(-R)은 로컬 포트가 여러 줄에 같을 수 있어 서버 포트로 부른다 */
function presetPort(p: ForwardPreset): number {
  return forwardKindOf(p) === "remote" ? p.remote_port : p.local_port;
}

/**
 * 이미 선 자리는 건너뛴다 — 창 이관은 포워드가 선 세션으로 같은 `onsession` 을 불러, 다시 걸면 자기 자신 때문에 실패한다.
 * 순차로 건다 — 실패 문구 순서가 폼의 줄 순서와 맞는다.
 */
async function openOn(sessionId: number, presets: ForwardPreset[]): Promise<string[]> {
  const open = await listForwards(sessionId);
  const taken = new Set(open.map(forwardBindKey));
  const failed: string[] = [];
  for (const p of presets) {
    const key = forwardBindKey(p);
    if (taken.has(key)) continue;
    try {
      await addForward(sessionId, p, t);
      taken.add(key);
    } catch (e) {
      const reason = stripReason(e instanceof Error ? e.message : String(e));
      failed.push(`${presetPort(p)} (${reason})`);
    }
  }
  return failed;
}

/**
 * 접속을 막지도 실패시키지도 않는다 — 호출부는 기다리지 않는다.
 * 설정의 별칭으로 붙는 타일만 — 빠른 접속 타일의 `alias` 로 찾으면 남의 호스트 설정을 연다.
 */
export async function openPresetForwards(pane: PaneSpec, sessionId: number): Promise<void> {
  const alias = pane.alias;
  if (!alias || !usesHostAlias(pane, alias)) return;

  const presets = (await getHostMeta(alias)).forwards;
  if (presets.length === 0) return;

  const failed = await openOn(sessionId, presets);
  await refreshPaneForwards(pane.id, sessionId);
  if (failed.length > 0) {
    showNotice(
      t("files.transfer.forward.preset.failed", { n: failed.length, list: failed.join(", ") }),
    );
  }
}

/**
 * 폼 저장 뒤 살아 있는 세션을 저장한 목록에 맞춘다 — 이름 변경 팬아웃 뒤에 불러야 `alias`(바뀐 뒤의 별칭)로 타일을 찾는다.
 * 차이만 건드린다(멀쩡한 터널을 끊으면 그 연결이 죽는다). 지워진 프리셋과 같은 줄을 손으로도 걸었으면 구분 못 해 닫는다.
 * 이 창만이다 — 다른 창의 타일은 재접속 전까지 옛 터널을 든다. 던지지 않는다.
 */
export async function syncPresetForwards(
  alias: string,
  before: ForwardPreset[],
  after: ForwardPreset[],
): Promise<void> {
  const { removed, added } = diffForwardPresets(before, after);
  if (removed.length === 0 && added.length === 0) return;

  const failedClose: string[] = [];
  const failedOpen: string[] = [];

  for (const tab of residentWindowTabs()) {
    for (const pane of listPanes(tab.root)) {
      if (!usesHostAlias(pane, alias)) continue;
      const sid = sessionOf(pane.id);
      if (sid === null) continue;

      if (removed.length > 0) {
        // 칩 표가 아니라 지금 선 것을 묻는다 — 잘못된 id 로 닫으면 남의 터널이 내려간다
        for (const f of await listForwards(sid)) {
          if (isAppForward(f)) continue;
          if (!removed.some((p) => sameForwardTarget(f, p))) continue;
          try {
            await removeForward(f.id, t);
          } catch (e) {
            const reason = stripReason(e instanceof Error ? e.message : String(e));
            failedClose.push(`${presetPort(f)} (${reason})`);
          }
        }
      }
      if (added.length > 0) failedOpen.push(...(await openOn(sid, added)));
      await refreshPaneForwards(pane.id, sid);
    }
  }

  if (failedClose.length > 0) {
    showNotice(
      t("files.transfer.forward.preset.closefailed", {
        n: failedClose.length,
        list: failedClose.join(", "),
      }),
    );
  }
  if (failedOpen.length > 0) {
    showNotice(
      t("files.transfer.forward.preset.failed", {
        n: failedOpen.length,
        list: failedOpen.join(", "),
      }),
    );
  }
}
