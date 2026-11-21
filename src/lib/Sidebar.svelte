<script lang="ts">
  import { tick } from "svelte";
  import { isRemote } from "$lib/ipc";
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

  // 호스트 트리 — 호스트 독(`Dock.svelte`) 안에서 산다. 이름만 Sidebar 다.

  /** "전체 열기 (타일)"(`onopenhosts`)에만 쓴다 — 탭이 하나도 없으면 둘 다 `""` 다 */
  let { tabId, paneId }: { tabId: string; paneId: string } = $props();

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

  const openHostsHere = onopenhosts
    ? (payload: HostsDrag) => onopenhosts(tabId, paneId, payload)
    : undefined;

  function notify(message: string) {
    if (onnotice) onnotice(message);
    else console.error(message);
  }

  let hosts = $state<HostEntry[]>([]);
  /** 볼트에 비밀번호가 담긴 별칭들(소문자) */
  let savedAliases = $state<Set<string>>(new Set());
  let warnings = $state<string[]>([]);
  let groupMeta = $state<Record<string, GroupMeta>>({});
  let loading = $state(true);
  let query = $state("");
  let listEl = $state<HTMLUListElement | null>(null);
  let bodyEl = $state<HTMLDivElement | null>(null);
  let searchEl = $state<HTMLInputElement | null>(null);

  // ── 펼침 ──
  // 옛 탐색기의 보기 키(`aynx:hosts:view`)는 읽지도 지우지도 않는다(`DOCK_LEGACY_STORE_KEY` 와 같은 이유).

  const EXPANDED_KEY = "aynx:hosts:expanded";

  function loadExpanded(): ReadonlySet<string> {
    try {
      return parseExpandedGroups(localStorage.getItem(EXPANDED_KEY));
    } catch {
      return new Set();
    }
  }

  let expanded = $state<ReadonlySet<string>>(loadExpanded());

  function saveExpanded(next: ReadonlySet<string>) {
    if (next === expanded) return;
    expanded = next;
    try {
      localStorage.setItem(EXPANDED_KEY, JSON.stringify([...next]));
    } catch {
      /* 저장 못 해도 이번 창의 펼침은 산다 */
    }
  }

  /** 사람이 바꾼 자리라 그 판만 움직인다(`treeMotion`) — 검색의 저절로 펼침은 이 문을 지나지 않는다 */
  function setOpen(path: string, open: boolean) {
    if (expanded.has(path) === open) return;
    treeMotion.mark(`host:${path}`);
    const next = new Set(expanded);
    if (open) next.add(path);
    else next.delete(path);
    saveExpanded(next);
  }

  function rebase(from: string, to: string) {
    saveExpanded(rebaseExpanded(expanded, from, to));
  }

  function pickedFolderIcon(path: string): string | null {
    return folderIcon(groupMeta[path]?.icon);
  }

  const searching = $derived(query.trim() !== "");
  const rows = $derived(
    hostTreeRows(
      hosts,
      groupMeta,
      expanded,
      query,
      {
        sortLevel:
          settings.hostSort === "recent" ? (level) => sortRowsByRecent(level, hostHistory()) : undefined,
        lastOkOf: (alias) => historyOf(hostHistory(), alias)?.last_ok_at ?? null,
      },
    ),
  );

  /** 검색 결과가 하나라도 있으면 내밀지 않는다 — 줄이 하나 더 있으면 Enter 의 대상이 흔들린다 */
  const quickTarget = $derived(searching && rows.length === 0 ? parseQuickConnect(query) : null);
  const quickConnectRow = $derived(
    quickTarget
      ? { label: quickConnectLabel(quickTarget), run: () => onquickconnect(quickTarget) }
      : null,
  );

  // ── 다중 선택 ──
  // 선택은 줄 번호가 아니라 id 로 잡는다 — 폴더 이동 · 검색이 줄 순서를 통째로 바꾼다.

  const sel = createSelection();

  const order = $derived(rows.map(rowId));

  /**
   * 골라져 있을 때만이다 — 선택 제어기는 빈 커서를 첫 줄에 보이지 않게 앉혀 두므로(`pruneSelection`),
   * 그대로 믿으면 아무것도 안 고른 Enter 가 첫 줄에 접속하고 `+` 가 첫 폴더에 호스트를 만든다.
   */
  const focusRow = $derived(
    sel.focus !== null && sel.has(sel.focus) ? rows.find((r) => rowId(r) === sel.focus) : undefined,
  );

  const targetFolder = $derived(folderOfRow(focusRow));

  const selPayload = $derived(payloadOfIds(order, sel.ids));

  $effect(() => sel.prune(order));

  function activate(row: HostTreeRow | undefined) {
    if (!row) return;
    if (row.kind === "folder") {
      if (!row.auto) setOpen(row.fullPath, !row.expanded);
    } else onconnect(row.host);
  }

  function focusId(id: string) {
    sel.click({ ctrlKey: false, metaKey: false, shiftKey: false }, id, order);
  }

  $effect(() => {
    void refreshKey;
    void load();
  });

  let loadSeq = 0;

  async function load() {
    const seq = ++loadSeq;
    // 함께 읽는다 — 아이콘이 같은 시점의 폴더 구조에 맞아야 한다.
    const [cfg, gm] = await Promise.all([loadHosts(t), listGroupMeta()]);
    if (seq !== loadSeq) return;
    hosts = cfg.hosts;
    warnings = cfg.warnings;
    groupMeta = gm;
    // 볼트 표식은 목록을 읽을 때 한 번만 묻는다 — 줄마다 묻지 않는다 (docs/log/2026-09-19-vault.md)
    savedAliases = new Set(
      (await vault.list().catch(() => []))
        .filter((i) => i.kind === "host_password")
        .map((i) => i.target.toLowerCase()),
    );
    loading = false;
    onhosts?.(cfg.hosts);
  }

  // id 에는 `/`·`.` 가 들어가므로 선택자에 끼우지 않고 순회해서 찾는다.
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

  // ── 드래그 ──

  /** dragover 에서는 값을 못 읽어 순환 판정용으로 손에 쥔다 — 다른 창에서 온 드래그면 `null` 이고 drop 에서 값으로 판정한다 */
  let dragPayload = $state<HostsDrag | null>(null);
  /** 한 틱 미뤄 켠다 — WebView2 는 dragstart 중 소스 요소가 조금이라도 움직이면 드래그를 통째로 취소한다 */
  let draggingIds = $state<ReadonlySet<string> | null>(null);
  let draggingTimer: ReturnType<typeof setTimeout> | null = null;
  /**
  /** `""`(최상위)와 `null`(없음)을 반드시 구분한다 */
  let dropTarget = $state<string | null>(null);

  /** 선택 갱신도 `draggingIds` 와 같은 틱에 미룬다 — dragstart 안에서 줄 그림이 바뀌면 위의 취소 규칙에 닿는다 */
  function startDrag(ev: DragEvent, row: HostTreeRow) {
    const dt = ev.dataTransfer;
    if (!dt) return;
    const next = sel.forDrag(rowId(row), order);
    const payload = payloadOfIds(order, next.ids);
    if (hostsDragEmpty(payload)) return;
    dragPayload = payload;
    dt.setData(HOSTS_DRAG_TYPE, encodeHostsDrag(payload));
    dt.setData("text/plain", [...payload.groups, ...payload.hosts].join("\n"));
    dt.effectAllowed = "copyMove";
    setCountGhost(dt, next.ids.size, t("app.hosts.drag.count", { count: next.ids.size }));
    draggingTimer = setTimeout(() => {
      draggingTimer = null;
      dropGhost();
      sel.set(next);
      draggingIds = next.ids;
    }, 0);
  }

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

  function isHostsDrag(ev: DragEvent): boolean {
    return ev.dataTransfer?.types.includes(HOSTS_DRAG_TYPE) ?? false;
  }

  function pathDragOver(ev: DragEvent, path: string) {
    if (!isHostsDrag(ev)) return;
    if (!canDropInto(dragPayload, path)) return;
    ev.preventDefault();
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
    // drop 에서도 값을 못 읽는 플랫폼이 있다 — 손에 쥔 것으로 대신한다
    const payload = hostsDragEmpty(raw) ? (dragPayload ?? emptyHostsDrag()) : raw;
    void moveInto(payload, path);
  }

  /** 항목(버튼) 위에서는 물러난다 — 그쪽이 이미 받았고, drop 은 버블해 한 번의 드롭이 두 번 처리된다 */
  const overItem = (ev: DragEvent) =>
    ev.target instanceof Element && ev.target.closest("button") !== null;

  function bodyDragOver(ev: DragEvent) {
    if (overItem(ev)) return;
    pathDragOver(ev, "");
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

  async function applyRename(from: string, to: string) {
    try {
      await renameGroup(from, to);
      rebase(from, to);
      await load();
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e));
    }
  }

  /** 호스트 쪽은 뜻만 위로 올린다 — 설정 쓰기는 완전 교체 패치라 한곳(`onassigngroups`)에서 관리한다 */
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

  // ── 러버밴드 ──

  const marquee = createMarquee({
    root: () => bodyEl,
    rects: () => boxesIn(bodyEl, listEl, "data-id"),
    selection: () => sel.state,
    apply: (rects, box, additive, base) => sel.marquee(rects, box, additive, base),
    onEmptyClick: () => sel.clear(),
    isItem: (t) => t instanceof Element && t.closest("button") !== null,
  });

  // ── 클립보드 · 일괄 조작 ──

  function copySelection() {
    if (hostsDragEmpty(selPayload)) return;
    setHostsClip("copy", selPayload);
  }

  function cutSelection() {
    if (hostsDragEmpty(selPayload)) return;
    setHostsClip("cut", selPayload);
  }

  async function pasteInto(dest: string) {
    const clip = hostsClip();
    if (!clip) return;
    if (clip.mode === "cut") {
      await moveInto(clip.payload, dest);
      clearHostsClip();
      return;
    }
    await pasteCopy(clip.payload, dest);
  }

  /** 호스트가 없는 폴더는 그룹 메타 항목이 유일한 존재 증거다 — 메타를 안 옮기면 빈 하위 폴더가 사라진다 */
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
   * 폴더 제거 = 그 아래 호스트를 전부 지우고 그룹 메타를 치운다 — 그래서 확인 문구에 하위 호스트 수와
   * 함께 정리되는 자리(`onhostrefs`)를 누르기 전에 적는다. 다이얼로그를 못 띄우면 지우지 않는다.
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
    const tail =
      names.length === 0
        ? t("app.hosts.remove.tail.foldersOnly")
        : t("app.hosts.remove.tail.hosts", { count: names.length });
    const refs = names.length === 0 ? null : (actions.onhostrefs?.(names) ?? null);
    const question = t("app.hosts.remove.confirm", { what, tail });
    let go = false;
    try {
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

  function openSelection() {
    if (hostsDragEmpty(selPayload)) return;
    openHostsHere?.(selPayload);
  }

  // ── 우클릭 메뉴 ──

  type MenuMode = "menu" | "confirm" | "newfolder";
  let menu = $state<HostMenuTarget | null>(null);
  let menuMode = $state<MenuMode>("menu");
  const edit = createInlineEdit();
  let folderEdit = $state<FolderEdit | null>(null);
  let folderEditInitial = { icon: "", color: "" };

  const newFolderParent = $derived(menu?.kind === "group" ? menu.path : "");

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

  function startNewFolder() {
    beginInlineEdit(edit, "");
    menuMode = "newfolder";
  }

  /** 빈 폴더는 그룹 메타에 기본 아이콘을 적어야만 남는다 — `set_group_meta` 는 아이콘이 비어 있지 않을 때만 그 키를 만든다 */
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
    if (parent !== "") setOpen(parent, true);
    try {
      await setGroupMeta(path, DEFAULT_FOLDER_ICON);
      await load();
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e));
    }
  }

  /** 아이콘 칸에 기본값(📁)은 채우지 않는다 — 폴더를 존재하게 하는 표식일 뿐 사람이 고른 것이 아니다 */
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

  let rootEl = $state<HTMLElement | null>(null);

  /** 그 폴더 줄로 키보드를 돌려준다 — 포커스가 `body` 로 떨어지면 ↑↓ · F2 가 트리에 닿지 않는다 */
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
   * 이름을 먼저, 그다음 아이콘·색 — 백엔드 이름 변경이 `[groups."<경로>"]` 를 메타째 새 경로로 옮기므로 메타는 새 경로에 쓴다.
   * 호스트가 하나도 없는 폴더는 아이콘을 비워도 📁 를 지킨다 — 비우면 폴더가 사라진다.
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
    // 빈 폴더 판정은 옮기기 전 목록으로
    const empty = hostsInGroup(hosts, f.path).length === 0;
    f.saving = true;
    f.error = null;
    try {
      if (name !== oldName) {
        const to = parent ? `${parent}/${name}` : name;
        await renameGroup(f.path, to);
        rebase(f.path, to);
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
    await load();
    closeFolderEdit();
  }

  function submitDissolve() {
    if (menu?.kind !== "group") return;
    const path = menu.path;
    closeMenu();
    void applyRename(path, "");
  }

  /** 값은 이벤트에서 직접 읽는다 — `bind:value` 와 이 핸들러 중 누가 먼저 도는지에 기대지 않는다 */
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

  /** 검색 칸에서 친 키도 버블링으로 여기 온다 — 글자의 키와 갈리는 것은 `inSearch` 로 가른다 */
  function onKeydown(ev: KeyboardEvent) {
    // IME 조합 중(한글 입력)에는 방향키·Enter 가 변환용이므로 가로채지 않는다
    if (ev.isComposing || ev.keyCode === 229) return;

    // 메뉴 · 폴더 편집 모달이 떠 있으면 키는 그쪽 것이다.
    if (menu || folderEdit) return;

    const target = ev.target as HTMLElement | null;
    const tag = target?.tagName;
    const inSearch = target !== null && target === searchEl;
    if (!inSearch && (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable)) return;

    // ── Ctrl 하나짜리 조합 ──
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

    // `Ctrl+Enter` 는 검색 칸에서도 통한다 — 치고 곧바로 새 탭으로 여는 몸짓이 이 키의 쓸모다.
    if (ev.ctrlKey && !ev.altKey && !ev.shiftKey && !ev.metaKey && ev.key === "Enter") {
      if (focusRow?.kind === "host") {
        ev.preventDefault();
        ev.stopPropagation();
        onconnectnew(focusRow.host);
      }
      return;
    }

    // 나머지 수식 조합은 전역 리졸버의 것이라 `preventDefault` 도 하지 않는다 — Shift 는 범위 넓히기라 거르지 않는다.
    if (ev.altKey || ev.ctrlKey || ev.metaKey) return;

    // 줄이 아닌 단추 위의 Enter·Space 는 그 단추의 것이다 — 여기서 또 읽으면 한 번에 두 가지가 일어난다.
    if ((tag === "BUTTON" || tag === "A") && !target?.dataset.id && (ev.key === "Enter" || ev.key === " "))
      return;

    const extend = ev.shiftKey;

    if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
      ev.preventDefault();
      const down = ev.key === "ArrowDown";
      // 아무것도 안 골랐으면 끝에서 시작한다 — 보이지 않는 커서에서 옮기면 첫 ↓ 가 둘째 줄에 떨어진다.
      if (sel.count === 0 && !extend) {
        const id = order[down ? 0 : order.length - 1];
        if (id !== undefined) focusId(id);
      } else sel.move(order, down ? 1 : -1, extend, false);
    } else if (ev.key === "Home" || ev.key === "End") {
      if (inSearch) return;
      ev.preventDefault();
      sel.move(order, ev.key === "Home" ? -order.length : order.length, extend, false);
    } else if (ev.key === "ArrowRight" || ev.key === "ArrowLeft") {
      if (inSearch || !focusRow) return;
      ev.preventDefault();
      const row = focusRow;
      if (ev.key === "ArrowRight") {
        if (row.kind !== "folder") return;
        if (!row.expanded) {
          setOpen(row.fullPath, true);
          return;
        }
        const next = rows[rows.indexOf(row) + 1];
        if (next && next.depth > row.depth) focusId(rowId(next));
      } else if (row.kind === "folder" && row.expanded && !row.auto) {
        setOpen(row.fullPath, false);
      } else {
        const parent = parentOfRow(row);
        if (parent !== "") focusId(`g:${parent}`);
      }
    } else if (ev.key === "Enter") {
      ev.preventDefault();
      activate(focusRow);
    } else if (ev.key === "F2") {
      if (focusRow?.kind === "host") {
        ev.preventDefault();
        onedithost(focusRow.host);
      } else if (focusRow?.kind === "folder") {
        ev.preventDefault();
        openFolderEdit(focusRow.fullPath);
      }
    } else if (ev.key === "Delete") {
      if (inSearch) return;
      ev.preventDefault();
      ev.stopPropagation();
      void removeSelection();
    } else if (ev.key === "Escape") {
      ev.preventDefault();
      // 겹을 하나라도 벗었으면 전파를 끊는다 — 끊지 않으면 독의 Escape 가 독까지 닫는다 (docs/log/2026-09-08-hosts-dock.md)
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

  function blurToTile(from: EventTarget | null) {
    if (!(from instanceof HTMLElement)) return;
    const box = from.closest<HTMLElement>("[data-tile-focus]");
    if (box) box.focus({ preventScroll: true });
    else from.blur();
  }

  /** 그릇(독)이 막 열렸을 때 부른다 — 지난 검색어는 통째로 갈아 치게 글자까지 고른다 */
  export function focusSearch(): void {
    searchEl?.focus({ preventScroll: true });
    searchEl?.select();
  }
</script>

<!-- `tabindex="-1" data-tile-focus` — 이 상자가 타일의 키보드 몸이다. 검색 칸에서 친 키도 여기서 듣는다. -->
<aside
  class="sidebar"
  role="presentation"
  tabindex="-1"
  data-tile-focus
  bind:this={rootEl}
  onkeydown={onKeydown}
>
  <!-- `~/.ssh/config` 는 ssh·VS Code 와 공유하는 원본이라 앱이 파일 전체를 재작성하지 않는다 -->
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
    <!-- 정렬 값은 `settings.toml` 의 `[hosts] sort` 에 남는다 — 프로젝트 칸과 나눠 쓰는 칸이다 -->
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
    <button
      type="button"
      class="btn btn-ghost icon-btn"
      data-host-add
      title={t("app.hosts.add")}
      aria-label={t("app.hosts.add")}
      onclick={() => onaddhost(targetFolder)}><UiIcon name="plus" size={14} /></button
    >
    <!-- 설정 파일 열기 — 메인 PC 의 기본 편집기를 띄우는 일이라(`open_ssh_config` 는 `remote/deny.rs` 가 거절) 원격 창에는 없다 -->
    {#if !isRemote}
      <button
        type="button"
        class="btn btn-ghost icon-btn"
        data-host-config
        title={t("app.hosts.config.title")}
        aria-label={t("app.hosts.config.aria")}
        onclick={onopenconfig}><UiIcon name="settings" size={14} /></button
      >
    {/if}
  </div>

  <!-- a11y: 이 상자에 role 을 주지 않는다 — 안에 든 `<ul>` 의 의미를 가린다 -->
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
    <FolderEditDialog bind:edit={folderEdit} onsubmit={() => void submitFolderEdit()} oncancel={closeFolderEdit} />
  {/if}
</aside>

<style>
  .sidebar {
    box-sizing: border-box;
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    min-height: 0;
    /* 타일 위에 뜨는 면이라 투명도를 타지 않는다 */
    background: var(--glass-inner, var(--surface-raised-solid));
    user-select: none;
  }

  /* 포커스 링은 그리지 않는다 — 타일 상자의 활성 테두리와 이중으로 겹친다 */
  .sidebar:focus {
    outline: none;
  }

  /* 러버밴드의 좌표 원점 */
  .body {
    position: relative;
    flex: 1;
    min-height: 0;
    overflow-y: auto;
  }

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
