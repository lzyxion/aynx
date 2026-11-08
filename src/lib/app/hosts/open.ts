// 호스트를 **여는 길들** — 지금 탭에(`connect`) · 새 탭에 · 끌어온 짐(호스트·폴더)을 격자로(`openHostsTiled`).
// 격자 자리 잡기는 `placeHosts` 하나를 지나고, 많으면 한 번 되묻는다(`resolveOpenTargets`).
import { askConfirm } from "$lib/app/confirm-dialog.svelte.js";
import { showNotice } from "$lib/app/notice";
import { t } from "$lib/i18n/i18n.svelte.js";
import { rememberTarget } from "$lib/app/prompts.svelte.js";
import {
  adoptPane,
  focusPane,
  moveTabBefore,
  openPaneHere,
  openTab,
  placePane,
  currentWorkspaceTabs,
  residentWindowTabs,
} from "$lib/app/tabs.svelte.js";
import {
  decodeHostsDrag,
  hostMeta,
  hostsDragEmpty,
  resolveHostsDrag,
  HOSTS_DRAG_TYPE,
  type HostEntry,
  type HostsDrag,
} from "$lib/hosts";
import {
  findFirstPane,
  findPane,
  flipDir,
  leafOf,
  newSshPane,
  newTab,
  tiledSubtree,
  type PaneSide,
  type PaneSpec,
  type SplitDir,
  type TabSpec,
} from "$lib/session";
import { hostCache, lookupHost } from "./list.svelte.js";

// ---------------------------------------------------------------------------
// 세션 타일에서 끌어온 것을 연다 — **호스트든 폴더든, 하나든 여럿이든 한 길**
// (docs/log/2026-09-03-group-open-tiled.md · docs/log/2026-09-04-hosts-multiselect.md)
//
// 예전에는 길이 둘이었다: 호스트 하나는 "그 자리에 하나", 그룹 하나는 "그 자리에 격자".
// 다중 선택이 생기면서 **호스트 셋 + 폴더 하나** 같은 짐이 들어올 수 있게 되자 그 갈래가
// 성립하지 않는다 — 어느 쪽으로 보내든 절반이 빠진다.
//
// 그래서 규칙을 하나로 접었다: 짐을 **별칭 목록으로 펴고**(`resolveHostsDrag`), 그 목록을
// `tiledSubtree` 로 균형 격자에 담는다. 하나면 잎 하나가 나오므로 결과가 예전의 "그 자리에
// 분할" 과 **글자 그대로 같다**.
//
// 진입점이 **넷**이고 전부 같은 함수를 지나므로 확인·계단 지연 규칙도 하나뿐이다:
//  ① 드래그 → 터미널 타일   ② 우클릭 "전체 열기 (타일)"
//  ③ 드래그 → 탭 바          ④ 명령 팔레트의 그룹 항목
// ---------------------------------------------------------------------------

/**
 * 이 개수를 **넘으면** 먼저 확인을 받는다.
 *
 * 6 인 이유: 2×3 격자까지는 타일 하나하나가 아직 읽을 만하고, 그 정도면 "보려고 연 것" 이라
 * 되묻는 쪽이 오히려 방해다. 그보다 크면 화면도 빽빽해지고 서버도 그만큼 두드리게 되므로 한
 * 번 묻는다. **오조작 안전망**이기도 하다 — 호스트를 집으려다 그룹 머리글을 잡고 터미널 위에
 * 떨어뜨리면 세션 스무 개가 소리 없이 열릴 수 있다.
 */
const GROUP_OPEN_CONFIRM_ABOVE = 6;

/**
 * 세션 사이의 시작 간격 (ms) — i 번째 패널은 `i × OPEN_STAGGER_MS` 만큼 늦게 붙는다.
 *
 * 한꺼번에 여는 것이 문제인 이유는 재연결에 지터를 넣은 이유와 **같다**: 동시에 뜬 SSH
 * 핸드셰이크는 sshd 의 `MaxStartups` 한도를 때리고, 넘친 연결은 그냥 끊긴다 — 사용자 눈에는
 * "그룹을 열면 몇 개는 늘 실패한다" 로 보인다. 120ms 면 10개를 열어도 총 1.1초라 사람이
 * 기다린다고 느끼지 않는다.
 */
const OPEN_STAGGER_MS = 120;

/**
 * 짐을 **열 별칭 목록**으로 풀고, 많으면 한 번 되묻는다. 열 것이 없거나 취소했으면 `null`.
 *
 * 확인을 **자리 잡기보다 먼저** 떼어 놓은 이유는 탭 바 드롭(③) 때문이다: 그쪽은 새
 * 탭을 만들어야 하는데, 확인을 그 뒤에 두면 취소했을 때 빈 탭이 덩그러니
 * 남는다. 먼저 물으면 취소가 곧 "아무 일도 없었다" 가 된다.
 */
async function resolveOpenTargets(payload: HostsDrag): Promise<string[] | null> {
  const names = resolveHostsDrag(hostCache(), payload);
  if (names.length === 0) {
    showNotice(t("files.host.open.none"));
    return null;
  }
  if (names.length <= GROUP_OPEN_CONFIRM_ABOVE) return names;
  // 다이얼로그를 못 띄웠으면 **열지 않는다** — 확인 없이 세션 스무 개를 여느니 아무 일도
  // 안 하는 쪽이 낫다 (이 경로는 권한이 있으므로 사실상 오지 않는다).
  try {
    const go = await askConfirm(t("files.host.openall.confirm", { count: names.length }), {
      title: t("files.host.openall.title"),
      kind: "warning",
    });
    return go ? names : null;
  } catch {
    showNotice(t("files.host.openall.askfail"));
    return null;
  }
}

/** 별칭 목록 → 계단식으로 붙을 패널 명세들 (첫 개는 지연 없음) */
function panesFor(names: string[]): PaneSpec[] {
  return names.map((name, i) => {
    const host = lookupHost(name);
    if (host) rememberTarget(host); // 비밀번호 모달이 "어디에 붙는 중인지" 를 말할 수 있게
    // 목록에 없는 별칭이어도 접속은 시도한다 (트리가 아직 못 읽었을 수 있다) —
    // 그 경우 스크롤백만 기본값이 된다.
    const pane = newSshPane(name, host ? hostMeta(host).scrollback : undefined);
    pane.openDelay = i * OPEN_STAGGER_MS;
    return pane;
  });
}

/**
 * 패널 묶음을 `targetPaneId` 의 `dir`·`side` 쪽에 격자로 앉힌다 — 자리 잡기의 공통 몸통.
 *
 * 넣는 서브트리의 첫 분할 방향은 바깥 분할(`dir`)의 **반대**다: 오른쪽 절반에 들어가는
 * 세로로 긴 블록은 가로선으로 나눠야 격자가 되지, 같은 방향으로 또 자르면 폭 좁은 띠가
 * 줄줄이 생긴다.
 */
function placeHosts(
  tab: TabSpec,
  targetPaneId: string,
  dir: SplitDir,
  side: PaneSide,
  panes: PaneSpec[],
): void {
  placePane(tab, tiledSubtree(panes, flipDir(dir)), targetPaneId, dir, side);
  // 포커스는 **첫 번째** 새 패널로 — 격자의 왼쪽·위, 가장 먼저 붙는 세션이다.
  focusPane(tab.id, panes[0].id);
  // 동시 입력이 켜진 탭이면 새 패널은 전부 기본 포함.
  for (const pane of panes) adoptPane(tab.id, pane.id);
}

/**
 * 짐(호스트·폴더 묶음)을 `targetPaneId` 의 `dir`·`side` 쪽에 연다 — **진입점 ①②④의 몸통**.
 *
 * 폴더는 하위 그룹까지 펼친다. 개수가 [`GROUP_OPEN_CONFIRM_ABOVE`] 를 넘으면 확인을 한 번
 * 거치고, 취소하면 아무 일도 일어나지 않는다. 접속은 [`OPEN_STAGGER_MS`] 간격의 계단식이다.
 */
export async function openHostsTiled(
  tabId: string,
  targetPaneId: string,
  dir: SplitDir,
  side: PaneSide,
  payload: HostsDrag,
): Promise<void> {
  if (hostsDragEmpty(payload)) return;
  const names = await resolveOpenTargets(payload);
  if (!names) return;
  // 확인을 기다리는 동안 탭이 닫히거나 대상 패널이 사라졌을 수 있다 — 다시 확인한다.
  const tab = residentWindowTabs().find((t) => t.id === tabId);
  if (!tab || !findPane(tab.root, targetPaneId)) return;
  placeHosts(tab, targetPaneId, dir, side, panesFor(names));
}

/**
 * 그룹 경로 하나를 여는 얇은 껍데기 — 명령 팔레트의 그룹 항목(④)이 쓴다.
 * 짐 모양으로 감싸 위 함수로 그대로 넘긴다 (규칙이 갈리지 않게).
 */
export function openGroupTiled(
  tabId: string,
  targetPaneId: string,
  dir: SplitDir,
  side: PaneSide,
  groupPath: string,
): void {
  const path = groupPath.trim();
  if (path === "") return;
  void openHostsTiled(tabId, targetPaneId, dir, side, { hosts: [], groups: [path] });
}

/**
 * **탭 바에 놓았다**(③) — 새 탭을 하나 만들어 짐을 통째로 격자로 연다.
 *
 * 새 탭은 시작 타일 하나로 태어나므로 격자가 그 자리를 곧바로 대신한다 — 결과는
 * 세션만 든 깨끗한 탭이다. 확인은 탭을 만들기 **전에** 끝난다.
 */
export async function dropHostsAsTab(
  payload: HostsDrag,
  beforeId: string | null,
): Promise<void> {
  if (hostsDragEmpty(payload)) return;
  const names = await resolveOpenTargets(payload);
  if (!names) return;
  const tab = openTab(newTab());
  // 탭 바가 보여 준 삽입선 그대로 꽂는다 (탭 순서 바꾸기와 같은 규칙 — `beforeId` 앞)
  if (beforeId !== null) moveTabBefore(tab.id, beforeId);
  placeHosts(tab, findFirstPane(tab.root).id, "row", "after", panesFor(names));
}

/**
 * 별칭 하나를 **새 탭**에서 연다 (빈 화면 드랍 · 목록에 없는 별칭 대비).
 *
 * 새 탭은 **시작 타일 하나**로 태어나므로 여기서 여는 세션이 그 자리를 곧바로
 * 대신한다 — 결과는 세션 타일 하나짜리 탭이다. 예전에는 호스트 타일로 시작해 그
 * 오른쪽을 갈랐지만, 그러면 부르지도 않은 트리가 절반을 차지한 채 남았다 (그 타일은
 * 2026-09-08 에 아예 사라졌다).
 */
function openAliasInNewTab(alias: string, scrollback?: number | null): void {
  const tab = openTab(newTab());
  const pane = newSshPane(alias, scrollback);
  placePane(tab, leafOf(pane), findFirstPane(tab.root).id, "row", "after");
  focusPane(tab.id, pane.id);
  adoptPane(tab.id, pane.id);
}

/**
 * 호스트 트리의 더블클릭·Enter·우클릭 "열기"/"새 세션" — **지금 탭에** 연다.
 *
 * 이 한 줄이 탭 모델의 핵심 변화다. 예전에는 호스트 이름의 **새 탭**이 생겼다 —
 * 서버 다섯 개를 보려면 탭 다섯 개였고, 나란히 보려면 그 다음에 하나씩 끌어다 합쳐야 했다.
 * 지금은 보고 있는 탭의 활성 타일 옆에 곧바로 붙는다.
 */
export function connect(host: HostEntry): void {
  rememberTarget(host);
  // sessions.toml 의 병합된 호스트별 스크롤백. 범위 밖·없음이면 newSshPane 이 무시한다.
  openPaneHere(newSshPane(host.name, host.meta?.scrollback));
}

/**
 * 호스트 하나를 **새 탭**에서 연다 — [`connect`] 의 짝.
 *
 * 진입점은 호스트 트리의 우클릭 메뉴 **"새 탭에서 열기"** 와 명령 팔레트다.
 * 빈 본문·탭 바 드랍은 짐을 통째로 받으므로 [`dropHostsAsTab`] 쪽으로 간다.
 */
export function connectInNewTab(host: HostEntry): void {
  rememberTarget(host);
  openAliasInNewTab(host.name, host.meta?.scrollback);
}

/**
 * 탭이 하나도 없을 때의 본문 드랍 → **새 탭**으로 연다.
 * 하나라도 있으면 손대지 않는다 — 그때는 `PaneHost` 가 패널 단위로 받는다.
 */
export function mainDragOver(ev: DragEvent): void {
  const dt = ev.dataTransfer;
  if (currentWorkspaceTabs().length > 0 || !dt?.types.includes(HOSTS_DRAG_TYPE)) return;
  ev.preventDefault();
  dt.dropEffect = "copy";
}

export function mainDrop(ev: DragEvent): void {
  const dt = ev.dataTransfer;
  if (currentWorkspaceTabs().length > 0 || !dt?.types.includes(HOSTS_DRAG_TYPE)) return;
  ev.preventDefault();
  void dropHostsAsTab(decodeHostsDrag(dt.getData(HOSTS_DRAG_TYPE)), null);
}
