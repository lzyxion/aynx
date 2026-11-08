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
 * **타일별로 살아 있는 포워드 표**와, 호스트 프리셋을 **세션에 반영하는 두 길**
 * (docs/log/2026-09-17-forward-presets.md).
 *
 * 두 길은 이렇다.
 *
 * | 언제 | 무엇 |
 * | --- | --- |
 * | 접속 직후 (`onsession`) | [`openPresetForwards`] — 저장해 둔 줄을 전부 연다 |
 * | 호스트 폼을 저장한 뒤 | [`syncPresetForwards`] — **바뀐 줄만** 살아 있는 세션에 맞춘다 |
 *
 * 몸통(`openOn`)은 하나다 — 열기 규칙(이미 선 자리는 건너뛴다 · 순차로 건다 · 실패는
 * 모아서 한 줄)이 두 길에서 갈리면 "접속하면 열리는데 저장하면 안 열리는 줄" 이 생긴다.
 *
 * ## 왜 `app/transfer` 가 아니라 별도 모듈인가
 *
 * 포워딩 **모달**은 지금도 `app/transfer.svelte.ts` 에 있다. 그런데 그 파일은 모달 우선순위를
 * 위해 `app/hosts.svelte.ts` 의 `hostFormOpen()` 을 읽고, 프리셋 반영을 부르는 자리는 그
 * `app/hosts.svelte.ts` 의 `submitForm` 이다 — 한 파일에 두면 값 순환이 선다
 * (`npm run check:cycles`). 그래서 **호스트 폼도 모달도 함께 볼 수 있는 아래층**으로 내렸다:
 * 이 모듈은 `app/hosts` 도 `app/transfer` 도 부르지 않는다.
 */

/**
 * **타일 id → 그 타일의 세션에 살아 있는 포워드들** — 머리줄 칩이 읽는 유일한 값.
 *
 * **목록이 바뀌는 자리**는 전부 우리가 지나는 길이다: 접속 직후의 프리셋 자동 열기
 * ([`openPresetForwards`]) · 호스트 폼 저장([`syncPresetForwards`]) · 추가 모달 · 칩 메뉴의 중지([`stopPaneForward`])
 * (`app/transfer` 의 `refreshForwards` 가 [`setPaneForwards`] 로 적는다) · 세션이 사라질 때
 * ([`clearPaneForwards`]). 밖에서 누가 리스너를 끄는 길은 없다.
 *
 * 그런데 **연결 수는 우리를 지나지 않는다** — 누군가 `psql -p 15432` 를 치는 순간 백엔드의
 * `active_conns` 만 올라가고 프런트는 아무 소식도 듣지 못한다. 칩의 초록 점이 말하려는 것이
 * 정확히 그 값이라 [`pollActive`] 가 그 하나를 위해 돈다 (아래 주석).
 *
 * **앱이 건 포워드(에이전트 신호)는 이 표에 들어오지 않는다** — 적는 세 자리([`pollActive`] ·
 * [`setPaneForwards`] · [`refreshPaneForwards`])가 모두 `userForwards` 를 거친다(사용자 결정 2026-10-27 —
 * 근거는 `$lib/forward` 의 `userForwards`). 그래서 사람 포워드가 0이면 칩도 타이머도 없다.
 */
const paneForwards = $state<Record<string, ForwardInfo[]>>({});

/**
 * 칩 표의 갱신 주기. 모달의 2초(`app/transfer` 의 `FORWARD_POLL_MS`)보다 느리다 — 모달은
 * 사람이 보고 있는 목록이고 이쪽은 눈가의 점이라 "몇 초 안에 켜지면 된다" 가 요구다.
 */
const CHIP_POLL_MS = 5000;

/** 표가 비어 있지 않은 동안만 도는 타이머 **하나** (타일마다 걸지 않는다 — 아래 주석) */
let chipTimer: ReturnType<typeof setInterval> | null = null;

/**
 * **표가 비었는가에 맞춰 타이머를 켜고 끈다** — 표를 건드리는 네 자리가 전부 이걸 부른다.
 *
 * 타일마다 인터벌을 걸지 않는 이유: 타일이 여덟이면 타이머도 여덟이고, 각자 다른 위상으로
 * 깨어나 `list_forwards` 를 흩뿌린다. 하나로 모으면 5초에 한 번 깨어나 그 순간 살아 있는
 * 타일만 훑는다 — `list_forwards` 는 메모리 표를 읽는 동기 명령이라(근거 주석이
 * `port_forward.rs` 에 있다) 몇 개를 이어 불러도 UI 스레드에 남는 자국이 없다.
 *
 * 포워드가 하나도 없으면 **타이머 자체가 사라진다**: 포워딩을 안 쓰는 사람에게는 이
 * 기능이 없는 것과 같다.
 */
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
 * 살아 있는 타일들의 포워드를 다시 읽는다 — **연결 수(`active_conns`)를 위한 한 바퀴**.
 *
 * **바뀐 타일만 적는다** ([`sameForwards`]). 5초마다 새 배열을 꽂으면 머리줄의 `$derived`
 * (툴팁 문자열)가 아무것도 달라지지 않은 채로 매번 다시 돈다.
 *
 * 세션 id 가 없는 타일(복원 대기·끊김)은 건너뛴다. 그 타일의 표를 지우지는 않는다 —
 * 세션이 정말 사라졌으면 `+page.svelte` 가 [`clearPaneForwards`] 로 지우고, 여기서
 * 넘겨짚으면 재접속 직전의 한 박자에 칩이 깜빡 사라진다.
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

/** 칩이 보는 것(개수·터널·연결 수)이 같은가 — 같으면 표를 건드리지 않는다 */
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

/** 이 타일의 세션에 살아 있는 포워드들 (없으면 빈 배열) — 머리줄 칩과 그 툴팁 */
export function forwardsOf(paneId: string): ForwardInfo[] {
  return paneForwards[paneId] ?? [];
}

/** 모달이 방금 읽은 목록을 칩에도 그대로 적는다 (`app/transfer` 의 `refreshForwards`) */
export function setPaneForwards(paneId: string, list: ForwardInfo[]): void {
  paneForwards[paneId] = userForwards(list);
  syncChipTimer();
}

/** 세션이 사라졌다 = 그 세션의 포워드도 백엔드가 이미 거뒀다 (`close_ssh`) */
export function clearPaneForwards(paneId: string): void {
  delete paneForwards[paneId];
  syncChipTimer();
}

/** 그 세션에 지금 서 있는 것을 다시 읽어 칩에 적는다 — 열고 닫은 뒤의 마지막 걸음 */
async function refreshPaneForwards(paneId: string, sessionId: number): Promise<void> {
  paneForwards[paneId] = userForwards(await listForwards(sessionId));
  syncChipTimer();
}

// ── 머리줄 포워딩 칩의 목록 메뉴가 부르는 셋 (`pane/forward-menu.svelte.ts` · 2026-10-11) ─────────────
//
// 줄 동작은 포워딩 대화상자가 하던 것 그대로다(중지 · 브라우저에서 열기) — 그 대화상자는 이제 **추가 전용**이고
// 목록은 메뉴가 쥔다. 실패는 대화상자의 오류 줄 대신 기존 알림 통로(`showNotice`)로 한 줄.

/** 메뉴가 뜨는 순간 한 번 — 칩 표는 5초 주기라 연결 수가 낡았을 수 있다. 세션이 없으면 아무것도 안 한다 */
export async function reloadPaneForwards(paneId: string): Promise<void> {
  const sid = sessionOf(paneId);
  if (sid === null) return;
  await refreshPaneForwards(paneId, sid);
}

/** 줄의 [중지] — 이미 사라진 id 도 성공이다(백엔드가 멱등). 앱이 건 포워드는 메뉴가 버튼을 세우지 않는다 */
export async function stopPaneForward(paneId: string, id: number): Promise<void> {
  try {
    await removeForward(id, t);
  } catch (e) {
    showNotice(e instanceof Error ? e.message : String(e));
  }
  await reloadPaneForwards(paneId);
}

/**
 * 줄의 [브라우저에서 열기] — 로컬(`-L`)만, 주소는 `forwardBrowserUrl`. `window.open` 도 앱 안 웹뷰도 아니라
 * 시스템 기본 브라우저다(웹뷰 안에서 열면 창이 브라우저가 되어 돌아올 길이 없다 — docs/log/2026-09-27-forward-open-browser.md).
 */
export function openForwardUrl(url: string): void {
  void openUrl(url).catch((e: unknown) => {
    console.error(`[aynx] 포워드를 브라우저로 열지 못했습니다: ${url}`, e);
    showNotice(t("app.forward.open.failed", { url }));
  });
}

/**
 * 실패 목록에 적는 그 줄의 이름 — **그 줄이 잡는 포트**다. 원격(-R)은 서버 포트가 그 줄을
 * 가리키고(로컬 포트는 여러 줄이 같을 수 있다), 로컬·동적은 내 PC 포트다.
 */
function presetPort(p: ForwardPreset): number {
  return forwardKindOf(p) === "remote" ? p.remote_port : p.local_port;
}

/**
 * 한 세션에 프리셋 줄들을 건다 — **두 길의 공통 몸통**. 실패한 줄을 `15432 (사유)` 모양으로
 * 돌려주고 알림은 부르는 쪽이 모아서 한 줄로 띄운다.
 *
 * **이미 선 자리는 건너뛴다** (`forwardBindKey` — 로컬·동적은 내 PC 포트, 원격은 서버 포트).
 * 창 이관(`resumeSession`)은 살아 있는 세션을 그대로 이어받아 같은 `onsession` 을 부르는데,
 * 그 세션에는 포워드가 이미 서 있다 — 다시 걸면 "포트가 이미 사용 중" 이 되어 **자기 자신
 * 때문에** 실패 토스트가 뜬다.
 *
 * **순차로** 건다. 리스너를 세우는 일이라 동시에 밀어 넣어도 빨라지지 않고, 실패 문구의
 * 순서가 사용자가 폼에서 본 줄 순서와 어긋난다.
 */
async function openOn(sessionId: number, presets: ForwardPreset[]): Promise<string[]> {
  const open = await listForwards(sessionId);
  const taken = new Set(open.map(forwardBindKey));
  const failed: string[] = [];
  for (const p of presets) {
    const key = forwardBindKey(p);
    if (taken.has(key)) continue;
    try {
      // 종류는 프리셋이 들고 온 그대로 넘긴다 (없으면 로컬 — `addForward` 가 채운다).
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
 * **호스트에 저장해 둔 포워딩을 접속 직후 자동으로 연다.**
 *
 * 부르는 자리는 하나다 — `+page.svelte` 의 `onsession(paneId, sid)` 에서 `sid` 가 붙는 순간.
 * 첫 접속도 자동 재연결도 `Terminal.startSession` 한 곳을 지나므로, 여기 하나면 두 길이 다
 * 덮인다 (재연결은 **새 세션 id** 라 옛 포워드가 이미 사라져 있고, 그래서 이 함수가 곧
 * 복원이기도 하다).
 *
 * 계약 셋:
 * - **접속을 막지도, 실패시키지도 않는다.** 전부 이 함수 안에서 끝나고 호출부는 기다리지 않는다.
 * - **설정의 별칭으로 붙는 SSH 타일만**이다 (`usesHostAlias`) — 빠른 접속 타일의 `alias` 는
 *   화면에 보이는 이름이라 그 글자로 sessions.toml 을 찾으면 남의 호스트 설정을 연다.
 *   tmux 타일은 **포함**이다: 포워드는 셸이 아니라 세션에 매달리므로 간이 모드와 무관하다.
 * - **성공은 조용하다.** 머리줄 칩이 이미 그것을 말한다. 실패만 한 줄로 모아 알린다.
 */
export async function openPresetForwards(pane: PaneSpec, sessionId: number): Promise<void> {
  const alias = pane.alias;
  if (!alias || !usesHostAlias(pane, alias)) return;

  // 상속이 없는 칸이라 **원본 = 병합값**이다 (`getHostMeta` 는 실패를 삼켜 빈 값을 준다).
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
 * **호스트 폼을 저장했다 — 살아 있는 세션을 저장한 목록에 맞춘다**
 * (docs/log/2026-09-17-forward-presets.md 의 "저장 시 열린 세션에 반영").
 *
 * 없던 시절의 증상: 프리셋에서 줄을 지우고 저장해도 이미 붙어 있는 타일의 터널은 그대로
 * 살아 있었다. 파일에는 없는데 포트는 물려 있으니, 사용자는 "지웠는데 안 없어진다" 를 보고
 * 원인을 찾을 자리가 없다 (재접속해야만 맞아떨어졌다).
 *
 * 부르는 자리는 하나다 — `app/hosts.svelte.ts` 의 `submitForm` 에서 **메타 저장이 성공하고
 * 이름 변경 팬아웃까지 끝난 뒤**. 그 순서인 이유: 이름을 바꿨으면 살아 있는 타일의 `alias` 도
 * 팬아웃이 방금 새 이름으로 고쳤고, 여기서 타일을 고르는 열쇠가 그 글자다. 그래서 인자
 * `alias` 는 **바뀐 뒤의 별칭**이다.
 *
 * 계약 넷:
 *
 * 1. **차이만 건드린다** (`diffForwardPresets`). 그대로 남은 줄은 손대지 않는다 — 멀쩡한
 *    터널을 끊었다 세우면 그 사이 그 포트를 쓰던 연결이 죽는다.
 * 2. **손으로 건 포워드는 안전하다.** 닫는 대상은 *지워진 프리셋과 같은 터널*뿐이라, 모달에서
 *    직접 건 줄은 어느 프리셋과도 짝이 맞지 않으면 그대로 산다. 다만 **지워진 프리셋과 정확히
 *    같은 줄을 손으로도 걸어 뒀다면 구분할 방법이 없다** — 백엔드가 주는 것은 포트 셋과 id
 *    뿐이고 "누가 걸었는가" 는 어디에도 없다. 그때는 닫히는 쪽을 고른다(저장한 목록이 뜻을
 *    이긴다). 다시 걸려면 모달에서 한 번 더 누르면 된다.
 * 3. **붙어 있는 타일만**이다. 세션 id 가 없는 타일(복원 대기·끊김)은 건드리지 않는다 — 붙는
 *    순간 [`openPresetForwards`] 가 **새 목록**으로 열어 준다.
 * 4. **이 창만**이다. 다른 창이 같은 호스트로 열어 둔 타일은 재접속 전까지 옛 터널을 그대로
 *    들고 있다 (이름 변경 팬아웃의 파일 쪽과 같은 한계). 창 사이로 새 이벤트를 쏘지 않는다.
 *
 * 던지지 않는다 — 실패는 기존 토스트 통로로 모아서 알린다. 저장은 이미 성공했고, 터널 하나를
 * 못 닫았다고 폼이 실패로 보일 이유가 없다.
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
        // **캐시가 아니라 지금 선 것**을 묻는다 — 칩 표(`paneForwards`)는 모달을 거치지 않고
        // 열린 줄까지 늘 알고 있다고 보장하지 않는다. 닫는 일에 잘못된 id 를 쓰면 남의
        // 터널이 내려간다.
        for (const f of await listForwards(sid)) {
          // 앱이 건 포워드(에이전트 신호)는 프리셋의 것이 아니다 — 맞추기가 건드리지 않는다.
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
