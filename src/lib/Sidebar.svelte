<script lang="ts">
  import { tick } from "svelte";
  import { askConfirm } from "$lib/app/confirm-dialog.svelte.js";
  import {
    loadHosts,
    hostsInGroup,
    listGroupMeta,
    renameGroup,
    setGroupMeta,
    HOSTS_DRAG_TYPE,
    decodeHostsDrag,
    emptyHostsDrag,
    encodeHostsDrag,
    hostsDragEmpty,
    type HostEntry,
    type GroupMeta,
    type HostsDrag,
  } from "$lib/hosts";
  import {
    affectedHosts,
    canDropInto,
    childFolderNames,
    folderOfRow,
    groupMetaPathsUnder,
    hostTreeRows,
    lastSegment,
    parentOfRow,
    parentPath,
    parseExpandedGroups,
    payloadOfIds,
    planMoveInto,
    planPasteCopy,
    rebaseExpanded,
    rowId,
    type HostMenuTarget,
    type HostTreeRow,
  } from "$lib/host-folders";
  import { historyOf, sortRowsByRecent } from "$lib/host-history";
  import { hostHistory } from "$lib/app/host-history.svelte.js";
  import { settings, setHostSort } from "$lib/settings.svelte.js";
  import { hostActions } from "$lib/pane/host-actions";
  import * as vault from "$lib/vault";
  import { parseQuickConnect, quickConnectLabel } from "$lib/quick-connect";
  import { clearHostsClip, hostsClip, setHostsClip } from "$lib/hosts-clipboard.svelte";
  import { DEFAULT_FOLDER_ICON, folderIcon } from "$lib/host-icons";
  import HostList from "$lib/browser/HostList.svelte";
  import { treeMotion } from "$lib/browser/tree-accordion";
  import HostMenu from "$lib/browser/HostMenu.svelte";
  import FolderEditDialog, { type FolderEdit } from "$lib/browser/FolderEditDialog.svelte";
  import UiIcon from "$lib/UiIcon.svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { createSelection } from "$lib/browser/selection-controller.svelte";
  import { boxesIn, createMarquee } from "$lib/browser/marquee.svelte";
  import { dropGhost, setCountGhost } from "$lib/browser/drag-ghost";
  import {
    beginInlineEdit,
    createInlineEdit,
    resetInlineEdit,
  } from "$lib/browser/inline-edit.svelte";

  // ---------------------------------------------------------------------------
  // 호스트 **트리** — **독 안에서 산다** (docs/log/2026-09-25-hosts-tree.md ·
  // docs/log/2026-09-08-hosts-dock.md · docs/log/2026-09-08-remove-hosts-tile.md).
  //
  // 이름은 역사적으로 Sidebar 지만 더는 사이드바가 아니다. 그릇이 세 번 바뀌었다:
  // 왼쪽 고정 칼럼(~9/3) → `kind:"hosts"` 타일(9/3~9/8) → **떠 있는 층 하나**(`Dock.svelte`).
  // 지금 이 컴포넌트를 그리는 곳은 그 독 하나뿐이고, 창에 인스턴스도 하나다.
  //
  // **그룹을 아래로 펼친다** (2026-09-25 — 프로젝트 칸과 같은 트리). 예전(9/3~9/25)에는 `cwd`
  // 하나로 한 층씩 들어가 보는 파일 탐색기였다(빵부스러기 · 뒤로/앞으로 · 새로고침 · 아이콘 보기).
  // 써 본 사용자의 말이 "생각보다 불편하다" 였다 — 호스트 수십 개를 고르는 데 폴더를 들락거릴
  // 까닭이 없었다. 줄의 모양·순서는 순수 층의 `hostTreeRows` 하나다(한 층 규칙 `folderRows` 위).
  //
  // 선택·러버밴드·메뉴 통로는 파일 타일과 **같은 파일**을 쓴다(`$lib/browser/`). 파일 타일의
  // 툴바·경로 칸(`BrowserToolbar` · `LocationBar`)은 이제 파일 타일만 쓴다.
  //
  // **놓는 곳이 뜻을 정한다**: 이 트리 **안**(폴더 줄 = 그 폴더, 호스트 줄 = 그 호스트가 든 폴더,
  // 빈 바닥 = 최상위)에 놓으면 정리(그룹 이동·중첩)이고, **터미널 타일** 위에 놓으면 접속이다.
  // ---------------------------------------------------------------------------

  /**
   * **어디에 여느냐** — 우클릭 "전체 열기 (타일)" 하나(`onopenhosts`)에만 쓴다. 독이
   * 활성 탭과 그 탭의 포커스된 타일을 채워 넣고, 탭이 하나도 없으면 둘 다 `""` 다
   * (그때는 상위가 탭 바 드랍과 같은 길로 보낸다). 나머지 콜백은 전부 호스트 컨텍스트에서
   * 꺼낸다 (docs/log/2026-09-05-refactor-structure.md).
   */
  let { tabId, paneId }: { tabId: string; paneId: string } = $props();

  // ---------------------------------------------------------------------------
  // 상위로 올리는 뜻들 — **컨텍스트에서 꺼낸다** (`$lib/pane/host-actions`).
  //
  // 예전에는 이 열다섯 개가 프롭이었고 `+page` → `PaneHost` → 여기로 흘러왔다. 뜻도 계약도
  // 그대로지만(각 콜백의 설명은 `HostActions` 에 있다) 중간의 `PaneHost` 가 이름을 다시
  // 늘어놓지 않아도 된다. 값은 전부 안정된 함수 참조라 초기화에서 한 번 펴 두면 되고,
  // 변하는 `refreshKey` 만 게터라 `$derived` 로 읽는다.
  // ---------------------------------------------------------------------------
  const actions = hostActions();
  const {
    onconnect,
    onaddhost,
    onedithost,
    onnewsession,
    onconnectnew,
    oninstallkey,
    onrenamehost,
    onduplicatehost,
    onremovehosts,
    onopenconfig,
    onassigngroups,
    onduplicatehosts,
    onhosts,
    onnotice,
    onopenhosts,
    onquickconnect,
  } = actions;
  const refreshKey = $derived(actions.refreshKey ?? 0);

  /**
   * 메뉴 "전체 열기 (타일)" — 짐에 **이 타일의 신원**을 붙여 올린다. 상위가 받아 주지
   * 않으면 `undefined` 라 메뉴 항목 자체가 그려지지 않는다 (예전 프롭 규칙 그대로).
   */
  const openHostsHere = onopenhosts
    ? (payload: HostsDrag) => onopenhosts(tabId, paneId, payload)
    : undefined;

  /** 안내 통로 — 상위가 주면 그리로, 아니면 콘솔로 (실패를 조용히 삼키지 않는다) */
  function notify(message: string) {
    if (onnotice) onnotice(message);
    else console.error(message);
  }

  let hosts = $state<HostEntry[]>([]);
  /** 볼트에 **비밀번호가 담긴** 별칭들 (소문자). 목록을 읽을 때 한 번 채운다 */
  let savedAliases = $state<Set<string>>(new Set());
  let warnings = $state<string[]>([]);
  /**
   * 그룹 전체 경로 → 표시용 메타(지금은 아이콘 하나). `load()` 마다 새로 읽어 갈아 끼운다.
   * 호스트 목록과 **같은 시점**의 스냅숏이라 이름 변경·재중첩 뒤에도 아이콘이 새 경로를 따라간다.
   */
  let groupMeta = $state<Record<string, GroupMeta>>({});
  let loading = $state(true);
  let query = $state("");
  let listEl = $state<HTMLUListElement | null>(null);
  /** 스크롤 상자 — 러버밴드의 좌표 원점이자 빈 곳 클릭을 받는 자리 */
  let bodyEl = $state<HTMLDivElement | null>(null);
  /**
   * 검색 칸 — 트리 키보드([`onKeydown`])가 "이 키가 그 칸에서 올라왔는가" 를 묻는 데
   * 쓴다. ←→·Delete·Ctrl+A/C/X/V 의 뜻이 "칸 안의 글자" 와 갈리는데, 그 질문은 칸 안에서만
   * 뜻이 있다.
   */
  let searchEl = $state<HTMLInputElement | null>(null);

  // ---------------------------------------------------------------------------
  // 펼침 — 폴더(전체 경로)마다 펼쳤는가. 창·세션을 건너 남는 **보는 사람의 편의**라
  // `localStorage` 다 (프로젝트 트리의 `aynx:projects:expanded` 와 같은 결 · 기본은 접힘).
  //
  // 옛 탐색기의 보기 모드 키(`aynx:hosts:view`)는 **읽지 않는다** — 남아 있어도 해가 없고,
  // 지우려다 던지는 편이 잃는 것이 크다(`DOCK_LEGACY_STORE_KEY` 주석과 같은 이유).
  // ---------------------------------------------------------------------------

  const EXPANDED_KEY = "aynx:hosts:expanded";

  /** 저장된 펼침 (없거나 못 읽으면 전부 접힘). 저장소 접근은 언제든 던질 수 있다 */
  function loadExpanded(): ReadonlySet<string> {
    try {
      return parseExpandedGroups(localStorage.getItem(EXPANDED_KEY));
    } catch {
      return new Set();
    }
  }

  let expanded = $state<ReadonlySet<string>>(loadExpanded());

  /** 펼침을 갈아 끼우고 기억한다 — 저장 실패는 이번 창만 못 남기는 것이라 조용히 넘긴다 */
  function saveExpanded(next: ReadonlySet<string>) {
    if (next === expanded) return;
    expanded = next;
    try {
      localStorage.setItem(EXPANDED_KEY, JSON.stringify([...next]));
    } catch {
      /* 저장 못 해도 이번 창의 펼침은 산다 */
    }
  }

  /**
   * 폴더 하나를 펼치거나 접는다 — 줄 클릭·→·←·Enter·끌다 머물기의 한 문. 사람이 바꾼 자리라 그 판만 움직인다
   * (`treeMotion` — 검색의 저절로 펼침은 이 문을 지나지 않는다).
   */
  function setOpen(path: string, open: boolean) {
    if (expanded.has(path) === open) return;
    treeMotion.mark(`host:${path}`);
    const next = new Set(expanded);
    if (open) next.add(path);
    else next.delete(path);
    saveExpanded(next);
  }

  /** 폴더 이름 변경·이동·해제 뒤 — 펼쳐 둔 가지가 새 경로를 따라간다 (`rebaseExpanded`) */
  function rebase(from: string, to: string) {
    saveExpanded(rebaseExpanded(expanded, from, to));
  }

  /**
   * 이 경로의 폴더가 **사용자가 손으로 고른** 아이콘을 갖고 있는가 — 있으면 그 값, 없으면
   * `null` (화면은 테마 색 SVG 폴더를 그린다).
   *
   * 규칙 자체(기본값 `📁` 는 "고른 것" 이 아니다)는 `host-icons.ts` 의 [`folderIcon`] 에
   * 있다 — 명령 팔레트도 같은 답을 써야 하기 때문이다.
   */
  function pickedFolderIcon(path: string): string | null {
    return folderIcon(groupMeta[path]?.icon);
  }

  /** 검색 중인가 — 빠른 접속 줄을 가르는 스위치 (저절로 펼침은 `hostTreeRows` 가 안다) */
  const searching = $derived(query.trim() !== "");
  /**
   * 지금 그릴 줄들(트리를 편 꼴) — 선택([`order`])·키보드·드래그가 모두 이 순서를 본다.
   *
   * 이름순(기본)은 한 층 모델(`folderRows`)이 이미 세운 순서다 — 층마다 폴더 먼저, 둘 다 글자순.
   * "최근" 정렬(`[hosts] sort = "recent"`)이면 층마다 **호스트 줄만** 마지막 접속순으로 다시
   * 세운다 — 폴더는 이름순 제자리다 (docs/log/2026-09-23-host-history.md). 검색 중에도 같은 규칙이다.
   */
  const rows = $derived(
    hostTreeRows(
      hosts,
      groupMeta,
      expanded,
      query,
      {
        sortLevel:
          settings.hostSort === "recent" ? (level) => sortRowsByRecent(level, hostHistory()) : undefined,
        // 줄 뒷글자 "2분 전" 의 근거 — 마지막 **성공** 시각 (런처 최근 호스트와 같은 값)
        lastOkOf: (alias) => historyOf(hostHistory(), alias)?.last_ok_at ?? null,
      },
    ),
  );

  /**
   * **빠른 접속 줄** — 검색이 아무것도 못 맞췄는데 친 글자가 접속 대상으로 읽힐 때만 선다
   * (docs/log/2026-09-16-quick-connect-and-host-keys.md).
   *
   * 조건 셋이 전부 필요하다: 검색 중이고 · 결과가 없고 · 문법을 통과한다. 결과가 하나라도
   * 있으면 내밀지 않는다 — 그때 사용자가 찾는 것은 그 호스트이고, 줄이 하나 더 있으면
   * Enter 의 대상이 흔들린다.
   */
  const quickTarget = $derived(searching && rows.length === 0 ? parseQuickConnect(query) : null);
  const quickConnectRow = $derived(
    quickTarget
      ? { label: quickConnectLabel(quickTarget), run: () => onquickconnect(quickTarget) }
      : null,
  );

  // ---------------------------------------------------------------------------
  // 다중 선택 — 규칙도 배선도 파일 타일과 **같은 파일**이 들고 있다
  // (`$lib/browser/selection-controller.svelte` 위의 `$lib/selection`).
  //
  // 예전에는 `selected: number`(줄 번호) 하나였다. 번호를 버린 이유는 **정렬이 아니라
  // 정체성**이 필요해졌기 때문이다: 폴더를 옮기거나 검색어를 치면 줄 순서가 통째로 바뀌는데,
  // 번호로 잡아 두면 골라 둔 것이 엉뚱한 줄로 옮겨 간다.
  // ---------------------------------------------------------------------------

  const sel = createSelection();

  /** 지금 보이는 순서대로의 id 목록 — Shift 범위·화살표·마퀴가 모두 이 순서를 본다 */
  const order = $derived(rows.map(rowId));

  /**
   * 지금 커서가 앉은 줄 (Enter·F2·←→ 의 대상) — **골라져 있을 때만**이다.
   *
   * 선택 제어기는 목록이 바뀔 때 비어 있는 커서를 첫 줄에 **보이지 않게** 앉혀 둔다
   * (`pruneSelection`). 그 커서를 그대로 믿으면 아무것도 안 고른 채 누른 Enter 가 첫 줄에 접속하고,
   * `+` 가 첫 폴더에 호스트를 만든다 — 화면에 강조가 없는데 대상이 생긴다. 그래서 골라진 줄만 친다.
   */
  const focusRow = $derived(
    sel.focus !== null && sel.has(sel.focus) ? rows.find((r) => rowId(r) === sel.focus) : undefined,
  );

  /**
   * **고른 줄이 가리키는 폴더** — `+`(호스트 추가)·`Ctrl+V` 가 "어디에" 를 이것으로 정한다.
   * 트리에는 들어가 있는 폴더(`cwd`)가 없으므로 고른 줄의 자리가 그 몫이다: 폴더 줄이면 그
   * 폴더, 호스트 줄이면 그 호스트가 든 폴더, 아무것도 안 골랐으면 최상위.
   */
  const targetFolder = $derived(folderOfRow(focusRow));

  /** 지금 선택 = 조작의 대상 (열기·이동·복사·제거가 모두 이 짐을 쓴다) */
  const selPayload = $derived(payloadOfIds(order, sel.ids));

  // 목록이 바뀌면(재로드·검색·접힘) 사라진 id 를 선택에서 떨어낸다.
  $effect(() => sel.prune(order));

  /**
   * 줄 하나를 "연다" — 폴더면 펼치거나 접고, 호스트면 접속한다 (Enter 의 뜻 · 폴더는 수식 없는 클릭 · 호스트는 더블클릭).
   * 검색이 저절로 펼친 폴더(`auto`)는 저장된 펼침과 무관하게 서 있으므로 건드리지 않는다.
   */
  function activate(row: HostTreeRow | undefined) {
    if (!row) return;
    if (row.kind === "folder") {
      if (!row.auto) setOpen(row.fullPath, !row.expanded);
    } else onconnect(row.host);
  }

  /** 줄 하나로 커서를 옮긴다 (그 줄 하나만 고른 상태) — ←→·Home·End 의 길 */
  function focusId(id: string) {
    sel.click({ ctrlKey: false, metaKey: false, shiftKey: false }, id, order);
  }

  // 마운트 시 1회 + refreshKey 가 바뀔 때마다 재로드.
  // (loadHosts 는 throw 하지 않으므로 실패해도 경고 한 줄로 내려온다.)
  $effect(() => {
    void refreshKey; // 의존성 등록
    void load();
  });

  // 재로드가 겹칠 때 늦게 끝난 옛 응답이 새 결과를 덮어쓰지 않게 하는 순번
  let loadSeq = 0;

  async function load() {
    const seq = ++loadSeq;
    // 호스트 목록과 그룹 메타를 **함께** 읽는다 — 아이콘이 같은 시점의 폴더 구조에 맞아야 한다.
    const [cfg, gm] = await Promise.all([loadHosts(t), listGroupMeta()]);
    if (seq !== loadSeq) return;
    hosts = cfg.hosts;
    warnings = cfg.warnings;
    groupMeta = gm;
    // 볼트 표식은 **목록을 읽을 때 한 번** 묻는다 (docs/log/2026-09-19-vault.md ③) —
    // 줄마다 물으면 호스트 스무 개에 왕복이 스무 번이고, 답은 어차피 한 벌이다. 잠겼거나
    // 볼트가 없으면 빈 집합이라 표식이 사라지는데, 그것도 정직한 그림이다(그 상태에서는
    // 담아 둔 값을 쓸 수 없다).
    savedAliases = new Set(
      (await vault.list().catch(() => []))
        .filter((i) => i.kind === "host_password")
        .map((i) => i.target.toLowerCase()),
    );
    loading = false;
    onhosts?.(cfg.hosts);
  }

  // 키보드로 옮긴 포커스 항목이 화면 밖이면 최소한만 스크롤.
  // (id 에는 `/`·`.` 같은 글자가 들어가므로 선택자에 끼워 넣지 않고 순회해서 찾는다.)
  $effect(() => {
    const id = sel.focus;
    if (id === null || !listEl) return;
    for (const el of listEl.querySelectorAll<HTMLElement>("[data-id]")) {
      if (el.dataset.id === id) {
        el.scrollIntoView({ block: "nearest" });
        return;
      }
    }
  });

  // ---------------------------------------------------------------------------
  // 드래그 — **종류 하나, 짐 하나** (docs/log/2026-09-04-hosts-multiselect.md)
  //
  // 호스트든 폴더든, 하나든 여럿이든 실리는 것은 `HOSTS_DRAG_TYPE` 한 종류에 담긴
  // [`HostsDrag`] JSON 이다. 사이드바는 **이름표만 든다** — "어디에 어떻게 열 것인가" 는
  // 받는 쪽(PaneHost 의 4분면 판정 → `+page`)의 일이다.
  //
  // 놓을 수 있는 곳은 셋이다: **폴더 줄**(그 폴더) · **호스트 줄**(그 호스트가 든 폴더) ·
  // **목록의 빈 바닥**(최상위). 셋 다 뜻이 같아("이 경로로") 드롭 처리도 하나뿐이다.
  // ---------------------------------------------------------------------------

  /**
   * 지금 끌고 있는 짐 — dragstart 에서 **동기로** 채운다.
   *
   * `dragover` 단계에서는 브라우저가 값을 안 보여 주므로, 폴더를 자기 안으로 넣는 순환인지를
   * 미리 따져 강조를 켜려면 이 손안의 값이 필요하다. 다른 창에서 온 드래그에서는 언제나
   * `null` 이고, 그때는 일단 받아 두었다가 놓는 순간에 값으로 판정한다.
   */
  let dragPayload = $state<HostsDrag | null>(null);
  /**
   * 반투명하게 그릴 항목 id 들 (표준 피드백). **한 틱 미뤄** 켠다: WebView2(Chromium)는
   * dragstart 가 도는 중에 소스 요소가 조금이라도 움직이면 드래그를 **통째로 취소**한다.
   * 드래그 고스트는 그 시점에 이미 캡처되므로 안전하다.
   */
  let draggingIds = $state<ReadonlySet<string> | null>(null);
  /** 위 두 가지(와 선택 갱신)를 한 틱 미루는 타이머 — dragend 에서 취소한다 */
  let draggingTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * 지금 드래그가 얹혀 강조 중인 **경로** (없으면 `null`). 그 경로의 폴더 줄이 강조되고,
   * `""`(최상위)면 목록 바닥이 강조된다 — `null`(없음)과 반드시 구분해야 한다.
   */
  let dropTarget = $state<string | null>(null);

  /**
   * 항목(호스트 줄·폴더 줄)에서 시작한 드래그.
   *
   * **고른 것을 끌면 선택 전체가, 고르지 않은 것을 끌면 그것 하나만** 실린다 (탐색기의 관례).
   * 선택이 바뀌는 경우 그 대입도 `draggingIds` 와 **같은 틱에** 미룬다 — 선택 표시가 바뀌면
   * 줄의 그림이 달라지고, 그것이 dragstart 안에서 일어나면 위의 취소 규칙에 닿는다.
   */
  function startDrag(ev: DragEvent, row: HostTreeRow) {
    const dt = ev.dataTransfer;
    if (!dt) return;
    const next = sel.forDrag(rowId(row), order);
    const payload = payloadOfIds(order, next.ids);
    if (hostsDragEmpty(payload)) return;
    dragPayload = payload;
    dt.setData(HOSTS_DRAG_TYPE, encodeHostsDrag(payload));
    // 앱 밖(에디터·터미널)으로 떨어뜨렸을 때를 위한 예의 — 이름이 줄줄이 글자로 떨어진다
    dt.setData("text/plain", [...payload.groups, ...payload.hosts].join("\n"));
    // 터미널 타일 위에 놓으면 여는 조작(copy), 트리 안에 놓으면 이동(move) —
    // 둘 다 허용하고 실제 커서(dropEffect)는 각 드롭 대상이 dragover 에서 정한다.
    dt.effectAllowed = "copyMove";
    setCountGhost(dt, next.ids.size, t("app.hosts.drag.count", { count: next.ids.size }));
    draggingTimer = setTimeout(() => {
      draggingTimer = null;
      dropGhost();
      sel.set(next);
      draggingIds = next.ids;
    }, 0);
  }

  /** 드래그가 끝났다 — 미뤄 둔 타이머가 남아 있으면 취소해 유령 강조가 남지 않게 한다 */
  function endDrag() {
    if (draggingTimer !== null) {
      clearTimeout(draggingTimer);
      draggingTimer = null;
    }
    dropGhost();
    draggingIds = null;
    dragPayload = null;
    dropTarget = null;
  }

  /** 이 드래그가 우리 것인지 (dragover 에서는 종류만 볼 수 있다) */
  function isHostsDrag(ev: DragEvent): boolean {
    return ev.dataTransfer?.types.includes(HOSTS_DRAG_TYPE) ?? false;
  }

  function pathDragOver(ev: DragEvent, path: string) {
    if (!isHostsDrag(ev)) return; // 파일 등 다른 드래그는 그냥 흘려보낸다
    if (!canDropInto(dragPayload, path)) return; // 순환·직속 자식·제자리면 안 받는다
    ev.preventDefault(); // preventDefault 해야 이 요소가 드롭 대상이 된다
    if (ev.dataTransfer) ev.dataTransfer.dropEffect = "move";
    dropTarget = path;
  }

  function pathDragLeave(path: string) {
    if (dropTarget === path) dropTarget = null;
  }

  function pathDrop(ev: DragEvent, path: string) {
    dropTarget = null;
    if (!isHostsDrag(ev)) return;
    ev.preventDefault();
    const raw = decodeHostsDrag(ev.dataTransfer?.getData(HOSTS_DRAG_TYPE) ?? "");
    // 값이 비어 오면(플랫폼에 따라 drop 에서도 못 읽히는 경우가 있다) 손에 쥔 것으로 대신한다
    const payload = hostsDragEmpty(raw) ? (dragPayload ?? emptyHostsDrag()) : raw;
    void moveInto(payload, path);
  }

  /**
   * 목록의 **빈 바닥**도 드롭 대상이다 — 뜻은 "최상위로"(호스트는 그룹에서 빼기 · 폴더는
   * 최상위로 올리기). 예전 빵부스러기의 "홈" 조각이 하던 일이다.
   *
   * 항목(버튼) 위에서는 **물러난다** — 그쪽이 자기 경로로 이미 받았고, 여기서 또 받으면
   * 한 번의 드롭이 두 번 처리된다 (drop 은 버블한다).
   */
  const overItem = (ev: DragEvent) =>
    ev.target instanceof Element && ev.target.closest("button") !== null;

  function bodyDragOver(ev: DragEvent) {
    if (overItem(ev)) return;
    pathDragOver(ev, ""); // 강조는 목록 바닥 전체에 붙는다 (= 최상위로)
  }

  function bodyDragLeave(ev: DragEvent) {
    const to = ev.relatedTarget;
    if (to instanceof Node && bodyEl?.contains(to)) return; // 자식 사이 이동도 dragleave 를 낸다
    pathDragLeave("");
  }

  function bodyDrop(ev: DragEvent) {
    if (overItem(ev)) return;
    pathDrop(ev, "");
  }

  /** 그룹 조작 하나를 적용하고 목록을 다시 읽는다. 실패는 안내로 알린다 (조용히 삼키지 않는다) */
  async function applyRename(from: string, to: string) {
    try {
      await renameGroup(from, to);
      rebase(from, to); // 펼쳐 둔 가지가 새 경로를 따라간다 (해제면 버린다)
      await load(); // 재로드가 onhosts 도 다시 쏘아 +page 스냅숏까지 갱신된다
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e));
    }
  }

  /**
   * 짐을 통째로 `path` 폴더로 옮긴다 — **드롭과 잘라내기 붙여넣기의 공통 몸통**.
   * `path` 가 `""`(최상위)이면 호스트는 그룹에서 빠지고 폴더는 최상위로 올라간다.
   *
   * 무엇을 어디로 옮길지는 순수 함수([`planMoveInto`])가 정한다 — **폴더를 먼저**, 그리고
   * 끌린 폴더 아래에 있던 호스트는 낱개 이동에서 뺀다(폴더와 함께 간다). 폴더 이동은
   * 자기완결적인 경로 연산이라 여기서 `renameGroup` 을 직접 부르고, 호스트 쪽은 뜻만 위로
   * 올린다 (설정 쓰기는 완전 교체 패치라 한곳에서 관리한다 — `onassigngroups` 주석).
   */
  async function moveInto(payload: HostsDrag, path: string) {
    if (hostsDragEmpty(payload)) return;
    const { renames, names } = planMoveInto(payload, path, hosts);
    for (const r of renames) {
      try {
        await renameGroup(r.from, r.to);
        rebase(r.from, r.to);
      } catch (e) {
        notify(e instanceof Error ? e.message : String(e));
      }
    }
    if (names.length > 0) onassigngroups(names, path === "" ? null : path);
    if (renames.length > 0) await load();
  }

  // ---------------------------------------------------------------------------
  // 러버밴드(마퀴) — 빈 곳에서 그어 여러 개를 한 번에 고른다 (파일 타일과 같은 기계장치)
  // ---------------------------------------------------------------------------

  const marquee = createMarquee({
    root: () => bodyEl,
    rects: () => boxesIn(bodyEl, listEl, "data-id"),
    selection: () => sel.state,
    apply: (rects, box, additive, base) => sel.marquee(rects, box, additive, base),
    onEmptyClick: () => sel.clear(),
    // 항목 위 = HTML5 드래그(항목 옮기기)의 자리다
    isItem: (t) => t instanceof Element && t.closest("button") !== null,
  });

  // ---------------------------------------------------------------------------
  // 클립보드 · 일괄 조작 (복사 · 잘라내기 · 붙여넣기 · 제거 · 전체 열기)
  //
  // 클립보드 자체는 `$lib/hosts-clipboard.svelte` 의 모듈 상태다 (타일을 둘 열어 서로
  // 주고받을 수 있어야 한다). 여기서는 **뜻**만 만든다:
  //   · 복사    = 담아 둔다. 붙이면 **복제**된다 (`-copy` 별칭 규칙은 상위의 것 그대로).
  //   · 잘라내기 = 담아 둔다. 붙이면 그 폴더로 **이동**한다 (드롭과 글자 그대로 같은 길).
  // 그래서 붙여넣기는 새 조작이 아니라 "드래그 없이 하는 드롭" 이고, 규칙이 갈릴 자리가 없다.
  // ---------------------------------------------------------------------------

  function copySelection() {
    if (hostsDragEmpty(selPayload)) return;
    setHostsClip("copy", selPayload);
  }

  function cutSelection() {
    if (hostsDragEmpty(selPayload)) return;
    setHostsClip("cut", selPayload);
  }

  /**
   * `dest` 폴더에 붙여넣는다 — 잘라내기면 이동, 복사면 복제. `Ctrl+V` 는 고른 줄의 폴더
   * ([`targetFolder`]), 메뉴는 그 메뉴의 대상(폴더 메뉴 = 그 폴더 · 빈 곳 = 최상위)에 붙인다.
   */
  async function pasteInto(dest: string) {
    const clip = hostsClip();
    if (!clip) return;
    if (clip.mode === "cut") {
      await moveInto(clip.payload, dest);
      clearHostsClip(); // 잘라내기는 한 번 쓰고 버린다 (원본이 이미 옮겨졌다)
      return;
    }
    await pasteCopy(clip.payload, dest);
  }

  /**
   * **복사 붙여넣기** — 계획은 순수 함수([`planPasteCopy`])가 세우고 여기서는 그대로 집행한다.
   *
   * 폴더 복사는 세 가지를 함께 옮겨야 폴더답다: ①하위 호스트 전부 ②그 하위 구조 ③그룹
   * 메타(아이콘) — 무엇보다 **호스트가 없는 폴더는 그룹 메타 항목이 유일한 존재 증거**라
   * 그것을 안 적으면 빈 하위 폴더가 사라진다.
   */
  async function pasteCopy(payload: HostsDrag, dest: string) {
    const plan = planPasteCopy(payload, dest, hosts, groupMeta, DEFAULT_FOLDER_ICON);
    for (const n of plan.notices) notify(t(n.key, n.params));
    for (const w of plan.metaWrites) {
      try {
        await setGroupMeta(w.path, w.icon, w.color);
      } catch (e) {
        notify(e instanceof Error ? e.message : String(e));
      }
    }
    if (plan.items.length > 0) onduplicatehosts(plan.items);
    await load();
  }

  /**
   * 선택한 것을 **제거**한다 — 파괴적이라 언제나 네이티브 확인을 한 번 거친다.
   *
   * 폴더는 "폴더를 지운다" 가 아니라 **그 아래 호스트를 전부 지우고 그룹 메타를 치운다** 는
   * 뜻이다 (폴더는 경로에서 유도되는 것이라 지울 실체가 따로 없다). 그래서 확인 문구에
   * 하위 호스트 수를 함께 적는다 — 폴더 하나를 골랐을 뿐인데 스무 개가 사라지는 일이
   * 없어야 한다. 다이얼로그를 못 띄우면 **지우지 않는다**.
   *
   * **그 별칭을 적어 둔 앱 쪽 자리**(즐겨찾기·스니펫·레이아웃·열린 타일)가 있으면 줄이 하나
   * 더 붙는다 — 제거는 언제나 그것들까지 치우고, 그 사실을 누르기 **전에** 말한다
   * (docs/log/2026-09-17-host-remove-fanout.md). 세는 것은 상위다 (`onhostrefs`).
   */
  async function removeSelection() {
    const payload = selPayload;
    if (hostsDragEmpty(payload)) return;
    const names = affectedHosts(payload, hosts);
    const parts: string[] = [];
    if (payload.groups.length > 0)
      parts.push(t("app.hosts.remove.what.groups", { count: payload.groups.length }));
    if (payload.hosts.length > 0)
      parts.push(t("app.hosts.remove.what.hosts", { count: payload.hosts.length }));
    const what = parts.join(" · ");
    // 호스트가 하나도 없으면(빈 폴더만 골랐다) 설정 파일은 손대지 않으므로 문구도 그렇게 적는다
    const tail =
      names.length === 0
        ? t("app.hosts.remove.tail.foldersOnly")
        : t("app.hosts.remove.tail.hosts", { count: names.length });
    // 함께 정리되는 자리 한 줄 — 없으면(또는 상위가 안 알려 주면) 문구는 예전 그대로다.
    const refs = names.length === 0 ? null : (actions.onhostrefs?.(names) ?? null);
    const question = t("app.hosts.remove.confirm", { what, tail });
    let go = false;
    try {
      // 두 문장을 잇는 것은 **줄바꿈**이다 (자리표시자가 아니라 배치다 — 어느 언어에서도
      // 뒷줄이 따로 선다).
      go = await askConfirm(refs === null ? question : `${question}\n\n${refs}`, {
        title: t("app.hosts.remove.title"),
        kind: "warning",
        danger: true,
      });
    } catch {
      notify(t("app.hosts.remove.noDialog"));
      return;
    }
    if (!go) return;
    // 폴더와 그 하위의 그룹 메타를 치운다 (아이콘을 비우면 그 항목 자체가 지워진다)
    for (const path of groupMetaPathsUnder(payload.groups, groupMeta)) {
      try {
        await setGroupMeta(path, null, null);
      } catch (e) {
        notify(e instanceof Error ? e.message : String(e));
      }
    }
    sel.clear();
    if (names.length > 0) onremovehosts(names);
    else await load();
  }

  /** "전체 열기 (타일)" — 고른 것을 통째로 위에 올린다 (드래그로 터미널에 놓는 것과 같다) */
  function openSelection() {
    if (hostsDragEmpty(selPayload)) return;
    openHostsHere?.(selPayload);
  }

  // ---------------------------------------------------------------------------
  // 우클릭 컨텍스트 메뉴 — 그림과 통로는 `HostMenu.svelte` 가, **뜻**은 여기가 갖는다.
  //
  // 폴더 조작(편집 = 이름·아이콘·색 · 해제)은 self-contained 경로 연산이라 사이드바가
  // `renameGroup`/`setGroupMeta` 를 **직접** 부르고 `load()` 로 재로드한다 (호스트 그룹
  // 지정처럼 metaToPatch 병합 걱정이 없다).
  // ---------------------------------------------------------------------------

  type MenuMode = "menu" | "confirm" | "newfolder";
  let menu = $state<HostMenuTarget | null>(null);
  let menuMode = $state<MenuMode>("menu");
  const edit = createInlineEdit();
  /**
   * 폴더 편집 모달 — 열려 있으면 그 값, 아니면 `null` (`FolderEditDialog`). 메뉴 "편집…" 과 폴더 줄의 `F2` 가 연다.
   * `initial` 은 연 순간의 아이콘·색 — 바뀐 것이 있을 때만 `set_group_meta` 를 부른다.
   */
  let folderEdit = $state<FolderEdit | null>(null);
  let folderEditInitial = { icon: "", color: "" };

  /** 새 폴더가 생길 부모 경로 — 배경 메뉴면 최상위, 그룹 메뉴면 그 폴더 안이다 */
  const newFolderParent = $derived(menu?.kind === "group" ? menu.path : "");

  /**
   * 줄 우클릭 — 선택 규칙을 먼저 맞춘 뒤(이미 골라진 것 위면 선택을 지킨다) 종류에 맞는
   * 메뉴를 연다. 폴더면 폴더 메뉴, 호스트면 호스트 메뉴다.
   */
  function openRowMenu(ev: MouseEvent, row: HostTreeRow) {
    ev.preventDefault();
    ev.stopPropagation();
    sel.pickForMenu(rowId(row), order);
    menuMode = "menu";
    resetInlineEdit(edit);
    menu =
      row.kind === "folder"
        ? { kind: "group", path: row.fullPath, x: ev.clientX, y: ev.clientY }
        : { kind: "host", host: row.host, x: ev.clientX, y: ev.clientY };
  }

  /**
   * **빈 배경** 우클릭 — 최상위에 대한 메뉴다 (폴더 추가 · 호스트 추가 · 붙여넣기 · 새로고침).
   * 최상위 폴더를 만드는 길은 여기 하나다(하위 폴더는 폴더 메뉴의 "하위 폴더 추가…").
   *
   * 줄의 자기 메뉴를 **가로채지 않는다**: 항목들은 `<button>` 이고 각자 `stopPropagation`
   * 하므로 여기까지 올라오지 않지만, 그 계약에만 기대지 않고 대상이 버튼 안이면 한 번 더
   * 물러선다 (빈 곳에서만 뜬다는 규칙이 이 메뉴의 정의다).
   */
  function openBgMenu(ev: MouseEvent) {
    if ((ev.target as HTMLElement | null)?.closest("button")) return;
    ev.preventDefault();
    menuMode = "menu";
    resetInlineEdit(edit);
    menu = { kind: "bg", x: ev.clientX, y: ev.clientY };
  }

  function closeMenu() {
    menu = null;
    menuMode = "menu";
    resetInlineEdit(edit);
  }

  /** 폴더 추가 모드로 — 빈 칸에서 시작한다 (부모는 `newFolderParent` 가 정한다) */
  function startNewFolder() {
    beginInlineEdit(edit, "");
    menuMode = "newfolder";
  }

  /**
   * 폴더 추가 확정.
   *
   * **빈 폴더를 만드는 방법은 그룹 메타에 기본 아이콘을 적는 것뿐이다** — 백엔드에 폴더라는
   * 실체가 없고 폴더는 그룹 경로에서 유도될 뿐이라, 호스트를 하나도 넣지 않고 폴더만 남기려면
   * `[groups."경로"]` 항목이 있어야 한다. `set_group_meta` 는 아이콘이 **비어 있지 않을 때만**
   * 그 키를 만들어 두므로 명시적 기본값(📁)이 필요하다.
   *
   * 검증은 셋뿐이다 — 비었는가 · `/` 가 섞였는가 · 이 층에 같은 이름이 이미 있는가.
   * 실패는 메뉴를 **열어 둔 채** 한 줄로 말한다.
   */
  async function submitNewFolder() {
    if (!menu || menu.kind === "host") return;
    const parent = newFolderParent;
    const name = edit.value.trim();
    if (name === "") {
      edit.error = t("app.hosts.folder.name.empty");
      return;
    }
    if (name.includes("/")) {
      edit.error = t("app.hosts.folder.name.slash");
      return;
    }
    if (childFolderNames(hosts, parent, groupMeta).has(name)) {
      edit.error = t("app.hosts.folder.name.dup");
      return;
    }
    const path = parent ? `${parent}/${name}` : name;
    closeMenu();
    // 하위 폴더를 만들었으면 부모를 펼쳐 둔다 — 접힌 채면 방금 만든 것이 보이지 않는다.
    if (parent !== "") setOpen(parent, true);
    try {
      await setGroupMeta(path, DEFAULT_FOLDER_ICON);
      await load();
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e));
    }
  }

  /**
   * **폴더 편집 모달을 연다** (이름 · 아이콘 · 색 — 2026-09-29, docs/log/2026-09-29-folder-project-icons.md).
   * 메뉴 "편집…"(`runOnMenu` 통로가 메뉴를 닫은 뒤 경로를 인자로 준다)과 폴더 줄의 `F2` 가 부른다.
   *
   * 아이콘 칸은 **사람이 고른** 아이콘(있으면)으로 채운다. 기본값(📁)은 채우지 않는다: 그 글자는 폴더가 존재하게
   * 하는 표식일 뿐 사용자가 고른 것이 아니라(`folderIcon`), 칸에 들어가 있으면 "이 폴더는 이모지 폴더" 처럼 보인다.
   */
  function openFolderEdit(path: string) {
    const icon = pickedFolderIcon(path) ?? "";
    const color = groupMeta[path]?.color?.trim() ?? "";
    folderEditInitial = { icon, color };
    folderEdit = { path, name: lastSegment(path), icon, color, error: null, saving: false };
  }

  function closeFolderEdit() {
    const path = folderEdit?.path;
    folderEdit = null;
    if (path !== undefined) void focusFolderRow(path);
  }

  /** 트리의 뿌리 (`<aside>`) — 모달이 닫힌 뒤 키보드가 돌아올 자리 */
  let rootEl = $state<HTMLElement | null>(null);

  /**
   * 폴더 편집이 닫히면 **그 폴더 줄로** 키보드를 돌려준다(이름을 바꿨으면 새 경로의 줄). 모달이 사라지며 포커스가
   * `body` 로 떨어지면 ↑↓ · F2 가 트리에 닿지 않는다. 줄이 없으면(검색에 걸러졌다) 뿌리에.
   */
  async function focusFolderRow(path: string) {
    await tick();
    const id = `g:${path}`;
    const row = rootEl?.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"]`);
    if (row) {
      focusId(id);
      row.focus({ preventScroll: true });
    } else rootEl?.focus({ preventScroll: true });
  }

  /**
   * 폴더 편집 저장 — **이름을 먼저, 그다음 아이콘·색**이다.
   *
   * - 이름이 바뀌었으면 옛 이름 변경 길 그대로(`applyRename` 과 같은 `renameGroup` — 부모 경로는 그대로, 마지막
   *   세그먼트만). 백엔드의 이름 변경은 `[groups."<경로>"]` 테이블을 **통째로 새 경로로 옮기므로**(아이콘·색 포함 —
   *   `rename_group_document` 의 2단계) 그 뒤의 메타 쓰기는 새 경로에 한다.
   * - 아이콘·색은 연 순간과 다를 때만 `set_group_meta` 한 번(두 칸을 함께). 빈 값은 지우기(null) — 단 **호스트가
   *   하나도 없는 폴더는 아이콘을 비워도 📁 를 지킨다**(그룹 메타가 그 폴더의 유일한 존재 증거라, 비우면 폴더가
   *   사라진다. 폴더를 없애는 뜻은 "그룹 해제" 가 따로 맡는다).
   *
   * 검증은 새 폴더와 같은 셋 — 비었는가 · `/` 가 섞였는가 · 같은 층에 같은 이름이 이미 있는가(자기 자신은 빼고).
   * 실패(검증·백엔드)는 모달을 **연 채** 한 줄로 말한다. 이름 변경만 성공하고 메타가 실패하면 모달의 경로가 새 경로를
   * 따라가 다시 누르면 메타만 적는다.
   */
  async function submitFolderEdit() {
    const f = folderEdit;
    if (!f || f.saving) return;
    const name = f.name.trim();
    const oldName = lastSegment(f.path);
    if (name === "") {
      f.error = t("app.hosts.folder.name.empty");
      return;
    }
    if (name.includes("/")) {
      f.error = t("app.hosts.folder.name.slash");
      return;
    }
    const parent = parentPath(f.path);
    if (name !== oldName && childFolderNames(hosts, parent, groupMeta).has(name)) {
      f.error = t("app.hosts.folder.name.dup");
      return;
    }
    const icon = f.icon.trim();
    const color = f.color.trim();
    const metaChanged = icon !== folderEditInitial.icon || color !== folderEditInitial.color;
    // 빈 폴더 판정은 **옮기기 전** 목록으로 — 이름을 바꿔도 안의 호스트 수는 그대로다
    const empty = hostsInGroup(hosts, f.path).length === 0;
    f.saving = true;
    f.error = null;
    try {
      if (name !== oldName) {
        const to = parent ? `${parent}/${name}` : name;
        await renameGroup(f.path, to);
        rebase(f.path, to); // 펼쳐 둔 가지가 새 경로를 따라간다
        f.path = to;
      }
      if (metaChanged) {
        await setGroupMeta(f.path, icon || (empty ? DEFAULT_FOLDER_ICON : null), color || null);
        folderEditInitial = { icon, color };
      }
    } catch (e) {
      f.error = e instanceof Error ? e.message : String(e);
      f.saving = false;
      await load(); // 이름만 바뀌었을 수 있다 — 목록은 지금 파일대로
      return;
    }
    await load(); // 재로드가 onhosts 도 다시 쏘아 +page 스냅숏까지 갱신된다
    closeFolderEdit();
  }

  /** 그룹 해제 확정 — `to === ""` 로 하위 호스트를 그룹에서 통째로 뺀다 */
  function submitDissolve() {
    if (menu?.kind !== "group") return;
    const path = menu.path;
    closeMenu();
    void applyRename(path, "");
  }

  /**
   * 검색어가 바뀌었다 — 걸린 **첫 호스트 줄**로 커서를 옮긴다(치고 곧바로 Enter · Ctrl+Enter 로
   * 붙을 수 있게 — 프로젝트 칸·팔레트와 같은 감각). 첫 줄이 저절로 펼친 폴더여도 건너뛴다: 찾는
   * 것은 호스트다. 검색어를 다 지우면 선택도 비운다.
   *
   * 값은 이벤트에서 직접 읽어 `query` 에 한 번 더 앉힌다 — `bind:value` 와 이 핸들러 중 누가
   * 먼저 도는지에 기대지 않으려고.
   */
  function onQueryInput(ev: Event) {
    query = (ev.currentTarget as HTMLInputElement).value;
    if (query.trim() === "") {
      sel.clear();
      return;
    }
    const first = rows.find((r) => r.kind === "host") ?? rows[0];
    if (first) focusId(rowId(first));
    else sel.clear();
  }

  /**
   * 뿌리에서 받는 트리 키보드 — **어디에 포커스가 있든 한 자리에서 듣는다**
   * (docs/log/2026-09-03-local-fs-tile.md). 검색 칸에서 친 키도 **버블링으로 여기까지 올라온다**.
   * 몇 가지는 "검색 칸에 포커스가 있는가"([`inSearch`])로 갈린다 — 거기서는 글자의 키다.
   *
   * 규칙 (프로젝트 트리와 같은 한 벌 — docs/log/2026-09-25-hosts-tree.md):
   *
   * - `↑`/`↓` : 보이는 줄(폴더 + 호스트)을 한 줄기로 훑는다 — 끝에서 **멈춘다**(프로젝트 트리와 같다).
   * - `Home`/`End` : 맨 위 · 맨 아래 줄 (검색 칸에서는 글자 사이의 키라 양보한다).
   * - `→` : 접힌 폴더면 펼치고, 펼친 폴더면 첫 아이로 간다.
   * - `←` : 펼친 폴더면 접고, 아니면(접힌 폴더·호스트) 부모 폴더 줄로 간다.
   *   검색 칸에서는 ←→ 가 글자 사이를 오가는 키라 건드리지 않는다.
   * - `Enter` : 폴더면 펼치기/접기, 호스트면 접속한다 (더블클릭과 같은 뜻).
   * - `Shift+↑↓·Home·End` : 앵커에서 지금 자리까지 **범위로 넓힌다** (다중 선택).
   * - `F2`    : 호스트면 그 호스트의 설정(우클릭 "편집…"), 폴더면 폴더 편집 모달(우클릭 "편집…").
   * - `Ctrl+A/C/X/V` : 전부 선택 · 복사 · 잘라내기 · 붙여넣기(고른 줄의 폴더에 — [`targetFolder`]).
   *   **검색 칸에서는 양보한다** (거기서는 글자를 고르고 복사하는 키다).
   * - `Delete` : 고른 것을 전부 제거 (확인 한 번). 검색 칸에서는 글자 지우기다.
   * - `Escape`: **선택 → 질의 → 독** 순으로 한 겹씩 빠져나온다.
   *
   * 옛 탐색기의 `Backspace`(뒤로) · `BrowserBack/Forward` · 마우스 뒤/앞 단추는 트리와 함께 없어졌다 —
   * 들어가 있는 폴더가 없으니 돌아갈 자리도 없다.
   */
  function onKeydown(ev: KeyboardEvent) {
    // IME 조합 중(한글 입력)에는 방향키·Enter 가 변환용이므로 가로채지 않는다
    if (ev.isComposing || ev.keyCode === 229) return;

    // 우클릭 메뉴가 떠 있으면 키는 그쪽 것이다 (`HostMenu` 가 Escape·↑↓ 를 이미 쓴다).
    // 폴더 편집 모달도 같다 — 그 안의 단추 위 ↑↓·Enter 가 뒤의 트리를 움직이면 안 된다.
    if (menu || folderEdit) return;

    const target = ev.target as HTMLElement | null;
    const tag = target?.tagName;
    /** 검색 칸에서 올라온 키인가 — ←→·Home/End·Delete·Ctrl+C 가 "여기는 글자밭" 을 따지는 근거 */
    const inSearch = target !== null && target === searchEl;
    // 검색 칸이 **아닌** 입력 요소(메뉴 안의 이름·아이콘 칸 등) 위의 키는 그 칸의 것이다.
    if (!inSearch && (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable)) return;

    // ── Ctrl 하나짜리 조합 — 선택·클립보드 ────────────────────────────────
    //
    // 전역 조합은 관례상 `Ctrl+Shift+…`·`Alt+…` 이고(기본 바인딩에 이 넷은 없다), 이 넷은
    // 어느 탐색기에서나 같은 뜻이라 자리마다 뜻이 달라지는 문제가 생기지 않는다.
    // **검색 칸에서는 양보한다** — 거기서는 글자를 고르고 복사하는 키다.
    if ((ev.ctrlKey || ev.metaKey) && !ev.altKey && !ev.shiftKey && !inSearch) {
      const take = () => {
        ev.preventDefault();
        ev.stopPropagation();
      };
      const k = ev.key.toLowerCase();
      if (k === "a") {
        take();
        sel.all(order);
        return;
      }
      if (k === "c") {
        take();
        copySelection();
        return;
      }
      if (k === "x") {
        take();
        cutSelection();
        return;
      }
      if (k === "v") {
        take();
        void pasteInto(targetFolder);
        return;
      }
    }

    // `Ctrl+Enter` — 고른 호스트를 **새 탭에서** 접속 (우클릭 "새 탭에서 접속" 과 같은 길 ·
    // 팔레트의 `Ctrl ↵ 새 탭` 과 같은 뜻 — docs/log/2026-09-25-unified-dock.md). 검색 칸에서도
    // 통한다: 치고 곧바로 새 탭으로 여는 몸짓이 이 키의 쓸모다. 폴더 줄에는 뜻이 없다.
    if (ev.ctrlKey && !ev.altKey && !ev.shiftKey && !ev.metaKey && ev.key === "Enter") {
      if (focusRow?.kind === "host") {
        ev.preventDefault();
        ev.stopPropagation();
        onconnectnew(focusRow.host);
      }
      return;
    }

    // 나머지 수식 조합은 이 트리의 것이 아니다 — 전부 앱 전역의 이름공간이다
    // (Alt+←/→ = 타일 포커스, Ctrl+D = 타일 닫기, Alt+1..9 = 탭). **`preventDefault`
    // 도 하지 않는다** — 전역 리졸버가 먼저 먹어야 하는 조합들이다.
    // (Shift 는 예외다 — 아래 화살표의 "범위 넓히기" 라 여기서 걸러 내면 안 된다.)
    if (ev.altKey || ev.ctrlKey || ev.metaKey) return;

    // 줄이 아닌 버튼(검색 줄의 정렬 · ＋ · ⚙) 위의 Enter·Space 는 **그 버튼을 누르는 키**다. 여기서
    // 또 "고른 줄 열기" 로 읽으면 한 번에 두 가지가 일어난다. 줄 단추(`data-id`) 위의 Enter 는
    // 트리의 것이다 — 아래에서 `preventDefault` 하므로 단추의 클릭(= 선택)으로 번지지 않는다.
    if ((tag === "BUTTON" || tag === "A") && !target?.dataset.id && (ev.key === "Enter" || ev.key === " "))
      return;

    /** Shift+화살표 = 앵커에서 여기까지 범위로 넓히기 */
    const extend = ev.shiftKey;

    if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
      ev.preventDefault();
      const down = ev.key === "ArrowDown";
      // 아무것도 안 골랐으면 **끝에서 시작한다**(↓ = 첫 줄 · ↑ = 끝 줄) — 보이지 않는 커서(`focusRow`
      // 주석)에서 한 칸 옮기면 첫 ↓ 가 둘째 줄에 떨어진다.
      if (sel.count === 0 && !extend) {
        const id = order[down ? 0 : order.length - 1];
        if (id !== undefined) focusId(id);
      } else sel.move(order, down ? 1 : -1, extend, false);
    } else if (ev.key === "Home" || ev.key === "End") {
      if (inSearch) return; // 칸 안에서는 글자의 처음·끝이다
      ev.preventDefault();
      sel.move(order, ev.key === "Home" ? -order.length : order.length, extend, false);
    } else if (ev.key === "ArrowRight" || ev.key === "ArrowLeft") {
      // 검색 칸에서는 글자 사이를 오가는 키다 (프로젝트 트리와 같은 양보).
      if (inSearch || !focusRow) return;
      ev.preventDefault();
      const row = focusRow;
      if (ev.key === "ArrowRight") {
        if (row.kind !== "folder") return;
        if (!row.expanded) {
          setOpen(row.fullPath, true);
          return;
        }
        // 펼쳐져 있으면 첫 아이로 (파일 탐색기 트리의 관례) — 바로 아래 줄이 한 단 깊으면 그게 아이다
        const next = rows[rows.indexOf(row) + 1];
        if (next && next.depth > row.depth) focusId(rowId(next));
      } else if (row.kind === "folder" && row.expanded && !row.auto) {
        setOpen(row.fullPath, false);
      } else {
        // 부모 폴더 줄로 — 최상위 줄이면 갈 곳이 없다
        const parent = parentOfRow(row);
        if (parent !== "") focusId(`g:${parent}`);
      }
    } else if (ev.key === "Enter") {
      ev.preventDefault();
      activate(focusRow);
    } else if (ev.key === "F2") {
      // 호스트면 호스트 설정, 폴더면 폴더 편집 (둘 다 우클릭 메뉴와 같은 진입점)
      if (focusRow?.kind === "host") {
        ev.preventDefault();
        onedithost(focusRow.host);
      } else if (focusRow?.kind === "folder") {
        ev.preventDefault();
        openFolderEdit(focusRow.fullPath);
      }
    } else if (ev.key === "Delete") {
      // 검색 칸에서는 글자를 지우는 키다
      if (inSearch) return;
      ev.preventDefault();
      ev.stopPropagation();
      void removeSelection();
    } else if (ev.key === "Escape") {
      ev.preventDefault();
      // **선택 → 질의 → 독** 순으로 한 겹씩 벗는다. 선택이 맨 앞인 이유는 그것이 가장 최근에
      // 만든 상태이고, 화면을 덮고 있는 것(강조된 줄들)이기 때문이다.
      //
      // 겹을 하나라도 벗었으면 **전파를 끊는다** — 그 위에 독의 Escape("닫기")가 있어, 끊지 않으면
      // 검색어를 지우는 한 번의 Escape 가 독까지 함께 닫는다 (docs/log/2026-09-08-hosts-dock.md).
      // 마지막 겹(더 벗을 것이 없다)만 올려보낸다.
      if (sel.count > 0) {
        ev.stopPropagation();
        sel.clear();
      } else if (query !== "") {
        ev.stopPropagation();
        query = "";
      } else {
        blurToTile(target);
      }
    }
  }

  /**
   * 검색 칸에서 물러나 **타일의 키보드 몸**으로 포커스를 넘긴다 (위 Escape 마지막 단계).
   *
   * 가장 가까운 `[data-tile-focus]` 를 거슬러 올라가 찾는다 — 대개 아래 `<aside>` 자신이고
   * (그러면 탐색 키가 계속 여기서 들린다), 없으면 `PaneHost` 의 타일 상자다. 둘 다 못
   * 찾으면(창 분리 등) 그냥 물러나기만 한다.
   */
  function blurToTile(from: EventTarget | null) {
    if (!(from instanceof HTMLElement)) return;
    const box = from.closest<HTMLElement>("[data-tile-focus]");
    if (box) box.focus({ preventScroll: true });
    else from.blur();
  }

  /**
   * **검색 칸에 커서를 둔다** — 이 트리를 담은 그릇이 "지금 막 열렸다" 고 말하는 유일한 길.
   *
   * 타일에는 필요 없었다(타일은 열려 있는 내내 그 자리에 있다). 호스트 독은 잠깐 떴다
   * 사라지는 층이라 열리는 순간의 뜻이 대개 "그 호스트를 찾겠다" 이고, 그때마다 손이 마우스로
   * 한 번 갔다 오면 단축키로 연 값어치가 없다 (docs/log/2026-09-08-hosts-dock.md).
   *
   * 글자까지 고른다 — 지난번 검색어가 남아 있으면 대개 통째로 갈아 친다.
   */
  export function focusSearch(): void {
    searchEl?.focus({ preventScroll: true });
    searchEl?.select();
  }
</script>

<!--
  `tabindex="-1" data-tile-focus` — 이 상자가 **타일의 키보드 몸**이다
  (docs/log/2026-09-03-hosts-toolbar-tile-focus.md · docs/log/2026-09-03-local-fs-tile.md).
  `Alt+화살표`로 이 타일에 들어오면 `PaneHost` 가 바디 대신 여기에 포커스를 주고, 탐색 키
  (↑↓ · ←→ · Enter · F2 · Escape)를 여기서 듣는다 — 검색 칸에서 친 키도 버블링으로
  올라오므로 규칙은 한 벌뿐이다. 탭 순회에는 끼지 않는다 (`-1`).
-->
<aside
  class="sidebar"
  role="presentation"
  tabindex="-1"
  data-tile-focus
  bind:this={rootEl}
  onkeydown={onKeydown}
>
  <!--
    검색 줄 — 런처 독 세 칸이 **같은 모양**으로 맨 위에 세우는 줄이다 (`Dock.svelte` 의
    `.dock-search` 규칙 · docs/log/2026-09-25-unified-dock.md). 칸 오른쪽에 이 칸의 조작 셋이 선다
    — 프로젝트 칸과 같은 자리·같은 단추(`.btn .btn-ghost .icon-btn`):

        정렬(이름 ↔ 최근) · ＋ 호스트 추가 · ⚙ 설정 파일 열기

    예전에는 이 아래에 탐색기 툴바(‹ › ↑ ⟳ · ＋ ▦ ⚙)와 빵부스러기(+ 정렬) 두 줄이 더 있었다.
    트리가 되며(docs/log/2026-09-25-hosts-tree.md) 돌아다닐 것이 없어져 둘 다 걷었고, 남은 조작
    셋만 여기로 올라왔다. 새로고침은 빈 곳 우클릭 "새로고침" 에 남는다(평소에는 창 포커스 복귀가
    알아서 다시 읽는다).

    키 처리는 여기 있지 않다 — **뿌리 `<aside>` 가 듣는다**. 여기서 친 키도 버블링으로
    거기까지 올라가므로 규칙은 한 벌이다 (docs/log/2026-09-03-local-fs-tile.md).

    설정 편집 진입점 정리: 추가는 파일 끝 append(＋), 수정은 그 호스트의 Host 블록만 국소
    패치(항목 우클릭 "편집…" · F2), 제거는 우클릭 "제거"(remove_host)로 그 블록만 지운다.
    `~/.ssh/config` 는 ssh·VS Code 와 공유하는 원본이라 앱이 파일 전체를 재작성하지 않는다.
  -->
  <div class="dock-search">
    <label class="dock-search-box">
      <UiIcon name="search" size={14} />
      <input
        class="search"
        type="search"
        bind:value={query}
        bind:this={searchEl}
        oninput={onQueryInput}
        placeholder={t("app.hosts.search.placeholder")}
        aria-label={t("app.hosts.search.aria")}
        autocomplete="off"
        spellcheck="false"
      />
    </label>
    <!--
      정렬 — 이름순 ↔ 최근 접속순 (docs/log/2026-09-23-host-history.md). **지금** 순서의 그림을
      보인다: 정렬은 목록을 보는 순간 "왜 이 순서인가" 가 궁금한 값이라 그 답이 단추에 있어야
      한다. 고른 값은 `settings.toml` 의 `[hosts] sort` 에 곧바로 남는다(`setHostSort` — 프로젝트
      칸과 나눠 쓰는 칸이다).
    -->
    <button
      type="button"
      class="btn btn-ghost icon-btn"
      title={settings.hostSort === "recent" ? t("app.hosts.sort.recent") : t("app.hosts.sort.name")}
      aria-label={settings.hostSort === "recent" ? t("app.hosts.sort.recent") : t("app.hosts.sort.name")}
      aria-pressed={settings.hostSort === "recent"}
      data-host-sort={settings.hostSort}
      onclick={() => setHostSort(settings.hostSort === "recent" ? "name" : "recent")}
      ><UiIcon name={settings.hostSort === "recent" ? "sort-recent" : "sort-name"} size={14} /></button
    >
    <!--
      호스트 추가 — **고른 줄의 폴더에** 만든다(`targetFolder` — 폴더 줄이면 그 폴더, 호스트 줄이면
      그 호스트의 폴더, 없으면 최상위). 폼의 그룹 칸에 그 경로가 채워져 뜬다.
    -->
    <button
      type="button"
      class="btn btn-ghost icon-btn"
      data-host-add
      title={t("app.hosts.add")}
      aria-label={t("app.hosts.add")}
      onclick={() => onaddhost(targetFolder)}><UiIcon name="plus" size={14} /></button
    >
    <button
      type="button"
      class="btn btn-ghost icon-btn"
      data-host-config
      title={t("app.hosts.config.title")}
      aria-label={t("app.hosts.config.aria")}
      onclick={onopenconfig}><UiIcon name="settings" size={14} /></button
    >
  </div>

  <!--
    본문 — 빈 곳 우클릭은 **최상위**의 메뉴다 (폴더 추가 · 호스트 추가 · 붙여넣기 · 새로고침).
    포인터 셋은 **러버밴드(마퀴)** 의 것이다: 빈 곳에서 눌러 끌면 사각형이 서고, 겹치는
    항목이 골라진다. 항목(버튼) 위에서 시작한 포인터는 손대지 않는다 (HTML5 드래그의 자리다).

    a11y: 이 상자에 role 을 주지 않는다 — 배경은 **비어 있음 그 자체**가 대상이라 이름 붙일
    역할이 없고, 안에 든 목록(`<ul>`)의 의미를 가리게 된다.
  -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="body"
    class:drop-root={dropTarget === ""}
    bind:this={bodyEl}
    oncontextmenu={openBgMenu}
    onpointerdown={marquee.pointerdown}
    onpointermove={marquee.pointermove}
    onpointerup={marquee.pointerup}
    onpointercancel={marquee.pointerup}
    ondragover={bodyDragOver}
    ondragleave={bodyDragLeave}
    ondrop={bodyDrop}
  >
    <HostList
      {rows}
      selection={sel}
      {order}
      {dropTarget}
      {draggingIds}
      iconOf={pickedFolderIcon}
      colorOf={(path) => groupMeta[path]?.color?.trim() || null}
      {loading}
      noHosts={hosts.length === 0}
      {searching}
      quickConnect={quickConnectRow}
      warning={warnings[0]}
      marqueeBox={marquee.box}
      {savedAliases}
      onactivate={activate}
      onexpand={(row) => setOpen(row.fullPath, true)}
      onmenu={openRowMenu}
      ondragstart={startDrag}
      ondragend={endDrag}
      ondragover={pathDragOver}
      ondragleave={pathDragLeave}
      ondrop={pathDrop}
      bind:listEl
    />
  </div>

  {#if warnings.length > 0}
    <details class="warnings" open={hosts.length === 0}>
      <summary>{t("app.hosts.warnings", { count: warnings.length })}</summary>
      <ul>
        {#each warnings as w}
          <li>{w}</li>
        {/each}
      </ul>
    </details>
  {/if}

  {#if menu}
    <HostMenu
      {menu}
      mode={menuMode}
      {edit}
      {newFolderParent}
      pasteTarget={targetFolder}
      selCount={sel.count}
      hasClip={hostsClip() !== null}
      canOpenAll={openHostsHere !== undefined}
      onclose={closeMenu}
      onmode={(next) => (menuMode = next)}
      onopenall={openSelection}
      oncut={cutSelection}
      oncopy={copySelection}
      onpaste={(dest) => void pasteInto(dest)}
      onremoveselection={() => void removeSelection()}
      onaddhost={(dest) => onaddhost(dest)}
      onreload={() => void load()}
      onstartnewfolder={startNewFolder}
      onsubmitnewfolder={() => void submitNewFolder()}
      oneditfolder={openFolderEdit}
      onsubmitdissolve={submitDissolve}
      onhostaction={(action, host) => action(host)}
      onremovehost={(host) => onremovehosts([host.name])}
    />
  {/if}

  {#if folderEdit}
    <!-- 폴더 편집 — 이름 · 아이콘 · 색 한 면 (메뉴 "편집…" · 폴더 줄 F2) -->
    <FolderEditDialog bind:edit={folderEdit} onsubmit={() => void submitFolderEdit()} oncancel={closeFolderEdit} />
  {/if}
</aside>

<style>
  /* 독 칸 하나를 그대로 채운다 — 테두리·둥근 모서리·그림자는 독 상자(`Dock.svelte`)가 그린다 */
  .sidebar {
    box-sizing: border-box;
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    min-height: 0;
    /* 타일 위에 뜨는 면이라 투명도를 타지 않는다 — 프로젝트 독(`ProjectList`)·모달과 같은 불투명 면.
       재질 글래스면 판은 독 상자가 칠하고 여기는 비운다(`--glass-inner`) */
    background: var(--glass-inner, var(--surface-raised-solid));
    user-select: none;
  }

  /* 타일 상자와 같은 규칙 — 포커스 링은 그리지 않는다 (`PaneHost` 의 `.pane-body:focus`).
     어느 타일이 포커스인지는 상자의 활성 테두리가 이미 말하고, 여기 링이 하나 더 뜨면
     타일 안에 네모가 이중으로 겹친다. */
  .sidebar:focus {
    outline: none;
  }

  /* `position: relative` 는 러버밴드의 좌표 원점이다 (`.marquee` 는 이 상자의 내용 좌표계에 앉는다) */
  .body {
    position: relative;
    flex: 1;
    min-height: 0;
    overflow-y: auto;
  }

  /* 최상위로 놓기 — 빈 바닥 위에 짐이 얹혔다. 폴더 줄의 `.drop-over` 와 같은 2px 테두리에 면은 넓은 칸이라 한 단 옅게,
     모서리는 펼친 폴더 판과 같은 16px(10-19 — DB 목록과 같은 값, 예전엔 둘이 따로 놀았다) */
  .body.drop-root {
    background: color-mix(in srgb, var(--accent) 10%, transparent);
    box-shadow: inset 0 0 0 2px var(--accent);
    border-radius: var(--radius-surface-inner);
  }

  .warnings {
    border-top: 1px solid var(--line);
    padding: var(--space-2) var(--space-3);
    font-size: var(--t-xs);
    color: var(--fg-2);
  }

  .warnings summary {
    cursor: pointer;
  }

  .warnings ul {
    margin: var(--space-2) 0 0;
    padding-left: 16px;
    max-height: 120px;
    overflow-y: auto;
  }

  .warnings li {
    margin-bottom: 4px;
    word-break: break-word;
    user-select: text;
  }
</style>
