<script lang="ts">
  import { tick } from "svelte";
  import { cubicOut } from "svelte/easing";
  import type { TransitionConfig } from "svelte/transition";
  import { runOnMenu } from "$lib/browser/menu-runner";
  import { insertIndexAt, measureLefts, playFlip } from "$lib/flip";
  import HostIcon from "$lib/HostIcon.svelte";
  import UiIcon from "$lib/UiIcon.svelte";
  import ProjectIcon from "$lib/ProjectIcon.svelte";
  import { hostActions } from "$lib/pane/host-actions";
  import { hostMeta, loadHosts, type HostEntry } from "$lib/hosts";
  import { MAX_FAVORITES, favoriteKey, favoriteName, favoriteTitle, resolveFavorites } from "$lib/favorites";
  import { favoriteDropKind, type FavoriteDropKind } from "$lib/favorite-drop";
  import { addDroppedFavorites } from "$lib/app/favorite-drop";
  import { favorites, moveFavorite, removeFavorite } from "$lib/favorites.svelte.js";
  import { openFavorite } from "$lib/app/open-favorite";
  import { projects } from "$lib/app/projects.svelte.js";
  import { workspaceDropBefore } from "$lib/workspaces/sidebar";
  import { moveTarget } from "$lib/reorder-keys";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { projectMarkers } from "$lib/app/project-locations.svelte.js";
  import { residentWindowTabs } from "$lib/app/tabs.svelte.js";
  import { listPanes } from "$lib/session/tree";
  import { DB_ENGINE_ICON } from "$lib/db-conn";
  import { dbConnLocations, dbDockConn } from "$lib/db-dock";
  import { openLocationMarkers } from "$lib/project-locations";
  import { ensureDbConns } from "$lib/app/db-conns.svelte.js";
  import { dbDockConnList, dbEngineLabel, dbOpenLocations } from "$lib/app/db-dock.svelte.js";
  import { currentWorkspaceId, workspaceList } from "$lib/app/workspaces.svelte.js";

  /**
   * **하단 독의 즐겨찾기 칸** (2026-10-13 — 워크스페이스 칸 자리를 물려받았다. 워크스페이스 전환 · 편집 · 삭제 · 순서 ·
   * 배지는 탭 줄 맨 앞 워크스페이스 목록(`Tabs.svelte`)이 맡는다).
   *
   * 즐겨찾기를 그리고 다루는 곳은 **이 독 하나**다(2026-10-23 — 시작 화면의 즐겨찾기 줄은 걷었다). 목록은 `favorites.svelte.ts`
   * (창에 하나뿐인 모듈 상태 · localStorage), 여는 길은 `app/open-favorite.ts`(호스트는 접속, 프로젝트 · DB 연결은 열기).
   * 더하는 길은 사이드 독의 호스트 · 프로젝트 · DB 연결 줄을 이 독으로 끌어다 놓는 것이고, `app/favorite-drop.ts` 가 **놓은 자리에** 끼운다(받는 규칙: 호스트 · DB 폴더는 받지 않음 ·
   * 열 칸 · 중복은 조용히 넘김). 끄는 동안 독을 여는 일은 `FloatingStatusDock` 이, 받는 일은 이 컴포넌트의 `dragOver` · `drop`
   * (판 전체에 배선 — `StatusBar.svelte`)이 한다.
   *
   * 칸 = 44×44 둥근 네모 얼굴(호스트 · 프로젝트 아이콘 · DB 엔진 로고 — 2026-10-18 End-4 식) 하나, 이름은 앱 말풍선(`title`), 이 워크스페이스에
   * 열려 있으면 칸 아래 primary 점. 우클릭 · 메뉴 키 · `Shift+F10` 은 작은 앱
   * 메뉴(즐겨찾기에서 빼기 — menu-runner 통로), 끌면 순서 바꾸기(같은 순수 함수 `reorderFavorites`), 포커스가 있으면
   * `Alt+←/→` · `Home`/`End` 로도 옮긴다. 목록이 비면 아무것도 그리지 않는다(독에는 핀 · 런처 단추만 선다).
   *
   * **놓을 자리 표시**(2026-10-23 — 점선 · 삽입선 · ＋ 칸은 쓰지 않는다, 사용자): 칸 사이에 대면 양옆이 벌어지고(약 120ms ·
   * 움직임 줄이기면 즉시) 그 틈에 끄는 것의 옅은 미리보기 칸이 선다. 더하기 끌기 · 칸 자리 바꾸기가 같은 틈(`gap`)을 쓴다.
   * 놓으면 미리보기가 진짜 칸이 되고 새 칸에 1초 테두리 강조. 이미 있는 칸이었으면 그 칸이 경고색으로 한 번 깜빡인다 —
   * `dragover` 에서는 짐의 값을 못 읽어 놓는 순간에야 알 수 있으므로 끄는 동안에는 틈이 벌어진다. 열 칸이 찼으면 틈 없이
   * "가득 참" 글자만 서고 놓을 수 없다(`dropEffect = "none"`).
   *
   * 메뉴는 독 **안**에 뜬다(`position: fixed` · 창 좌표) — 밖에 두면 독의 바깥 누르기 감지가 메뉴 줄을 누르는 순간 독을
   * 접는다. 메뉴 · 끌기 동안은 `busy` 로 독이 접히지 않게 한다.
   */
  let {
    busy = $bindable(false),
    count = $bindable(0),
    iconSize = 20,
  }: {
    /** 메뉴가 떠 있거나 끄는 중인가 — 독(`FloatingStatusDock`)이 그동안 접히지 않는다 */
    busy?: boolean;
    /** 지금 그린 칸 수(놓을 자리 미리보기 칸 포함) — 독이 구분선을 몇 개 세울지 가른다(0 이면 이 칸 묶음이 없다) */
    count?: number;
    /** 얼굴 안 아이콘 크기 — 독의 다른 글리프와 같은 값을 받는다 */
    iconSize?: number;
  } = $props();

  // ---------------------------------------------------------------------------
  // 호스트 목록 — 호스트 칸은 별칭만 들고 있어 그릴 때 지금 목록에서 다시 찾는다(`resolveFavorites`). 스스로
  // 한 번 읽는다(앱을 켜자마자 독을 열면 상위 캐시가 아직 비어 있다). 호스트 칸이 하나도 없으면 읽지 않는다.
  // ---------------------------------------------------------------------------
  const actions = hostActions();
  const { onconnect, onhosts } = actions;
  const refreshKey = $derived(actions.refreshKey ?? 0);
  let hosts = $state<HostEntry[]>([]);
  const wantsHosts = $derived(favorites().some((f) => f.kind === "host"));
  $effect(() => {
    void refreshKey;
    if (!wantsHosts) return;
    let alive = true;
    void loadHosts(t).then((cfg) => {
      if (!alive) return;
      hosts = cfg.hosts;
      onhosts?.(cfg.hosts);
    });
    return () => {
      alive = false;
    };
  });

  // DB 연결 — 칸은 id 만 들고 있어 연결 목록 사본(`app/db-conns`)에서 다시 찾는다. DB 칸이 있을 때만 한 번 읽는다(독 DB 칸이 아직 안 열렸으면 비어 있다)
  const wantsDbs = $derived(favorites().some((f) => f.kind === "db"));
  $effect(() => {
    if (wantsDbs) void ensureDbConns();
  });

  const favs = $derived(resolveFavorites(favorites(), hosts, projects(), wantsDbs ? dbDockConnList().map(dbDockConn) : []));
  const favKeys = $derived(favs.map((f) => f.key));
  $effect(() => {
    count = favs.length + (gap !== undefined ? 1 : 0);
  });

  /**
   * **열린 곳 점** — 그 즐겨찾기가 이 워크스페이스에 지금 열려 있는가(칸 아래 primary 점, 2026-10-18 End-4 식 독).
   * 프로젝트는 사이드 독 목록과 같은 판정(`projectMarkers(p).here`), 호스트는 이 창의 탭에 그 별칭의 SSH 타일이 있는가,
   * DB 연결은 독 DB 줄의 "여기 열림" 표식과 같은 판정(그 연결의 쿼리 타일이 지금 워크스페이스에 있는가 — `DbList.svelte` 의 `markersOf`).
   */
  const openHosts = $derived(new Set(
    residentWindowTabs().flatMap((tab) => listPanes(tab.root)).filter((pane) => pane.kind === "ssh" && pane.alias).map((pane) => pane.alias!),
  ));
  const dbLocations = $derived(wantsDbs ? dbOpenLocations() : []);
  function isOpen(fav: (typeof favs)[number]): boolean {
    if (fav.kind === "host") return openHosts.has(fav.host.name);
    if (fav.kind === "db") return openLocationMarkers(dbConnLocations(dbLocations, fav.conn.id), currentWorkspaceId(), workspaceList()).here;
    return projectMarkers(fav.project).here;
  }

  const iconOf = (host: HostEntry) => hostMeta(host).icon?.trim() || null;
  const colorOf = (host: HostEntry) => hostMeta(host).color?.trim() || null;

  // ---------------------------------------------------------------------------
  // 우클릭 메뉴 — 즐겨찾기에서 빼기 하나(호스트 · 프로젝트 · DB 연결 자체는 그대로다)
  // ---------------------------------------------------------------------------
  let menu = $state<{ key: string; x: number; y: number } | null>(null);
  let menuEl = $state<HTMLDivElement | null>(null);
  let row = $state<HTMLDivElement | null>(null);

  function openMenu(key: string, x: number, y: number): void {
    menu = { key, x: Math.max(4, Math.min(x, window.innerWidth - 192)), y: Math.max(4, Math.min(y, window.innerHeight - 52)) };
    void tick().then(() => menuEl?.querySelector<HTMLElement>("[role='menuitem']")?.focus());
  }
  /** 메뉴를 닫는다 — Escape 로 닫았으면 포커스를 그 칸으로 돌려준다. 독이 접힐 때도 부른다 */
  export function closeMenu(back = false): void {
    const key = menu?.key;
    menu = null;
    if (back && key) focusCell(key);
  }
  function focusCell(key: string): void {
    row?.querySelector<HTMLElement>(`[data-dock-fav="${CSS.escape(key)}"]`)?.focus();
  }
  /** 메뉴 줄 — 스냅샷(그 칸) → 닫기 → 빼기 (docs/conventions.md "메뉴를 닫는 코드") */
  function removeFromMenu(): void {
    runOnMenu(() => favs.find((f) => f.key === menu?.key)?.fav, () => (menu = null), removeFavorite);
  }

  // ---------------------------------------------------------------------------
  // 끌어서 순서 바꾸기 — 옛 워크스페이스 칸과 같은 포인터 몸짓(문턱 5px 전에는 클릭 그대로 · `Esc` 취소 · 놓은 직후의 클릭
  // 하나는 무시). 설정 › 머리줄 칩과 같은 모양이다: 끄는 칸은 자리(폭)만 남기고 사라지고(`.lifted`), 그 빈자리가 커서 x 를
  // 따라 옮겨 다니며(보이는 순서 `order` · `insertIndexAt`) 이웃이 FLIP 으로 비켜선다. 놓으면 그 자리에 내려앉고(`playFlip` 의 pop),
  // 줄 밖에 놓거나 `Esc` 면 원래 순서로 미끄러져 돌아간다. 들고 있는 것은 커서를 따라오는 잔상이다. 더하기 끌기의 틈(`gap`)과는 따로다.
  // ---------------------------------------------------------------------------
  /** `px`·`py` = 지금 커서, `ox`·`oy` = 칸 안에서 잡은 자리 — 잔상(`.dock-fav-ghost`)이 잡은 그 점을 커서에 붙여 따라온다 */
  let drag = $state<{
    key: string; pointerId: number; x: number; y: number; moved: boolean; px: number; py: number; ox: number; oy: number;
  } | null>(null);
  let dragEndedAt = -Infinity;
  /** 자리 바꾸기 동안 보이는 순서(끄는 칸의 빈자리가 이미 놓일 곳에 있다) — 끌지 않을 때는 `null` */
  let order = $state<string[] | null>(null);
  const shown = $derived.by(() => {
    const cur = order;
    if (!cur) return favs;
    const byKey = new Map(favs.map((f) => [f.key, f]));
    return cur.flatMap((k) => byKey.get(k) ?? []);
  });

  /** 상태를 바꾸고(`change`) 바뀐 자리로 미끄러지게 — `pop` 은 방금 놓인 칸(내려앉는다). 설정 › 머리줄 칩과 같은 `$lib/flip` */
  async function flipRow(change: () => void, pop: string | null = null): Promise<void> {
    const g = row;
    const before = g ? measureLefts(g) : null;
    change();
    if (!g || !before) return;
    await tick();
    playFlip(g, before, pop);
  }

  /** 벌어진 틈 — 키 = 그 칸 앞 · `null` = 맨 뒤 · `undefined` = 틈 없음 */
  let gap = $state<string | null | undefined>(undefined);
  /** 사이드 독에서 끌어 오는 짐(더하기) — 종류 · 열 칸이 찼는가 */
  let addDrag = $state<{ kind: FavoriteDropKind; full: boolean } | null>(null);
  /** 참이면 틈이 움직임 없이 닫힌다 — 놓은 순간 미리보기가 진짜 칸으로 바뀌는 자리(둘이 겹쳐 폭이 튀지 않게) */
  let settle = false;
  /** 자리 바꾸기 중 끄는 칸 — 잔상의 얼굴 */
  const movingFav = $derived(drag?.moved ? favs.find((f) => f.key === drag?.key) ?? null : null);

  const reducedMotion = () =>
    typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

  /** 틈이 벌어지고 닫히는 움직임 — 미리보기 칸의 폭을 0 ↔ 제 폭으로(양옆 칸이 그만큼 비켜선다) */
  function grow(node: HTMLElement): TransitionConfig {
    if (settle || reducedMotion()) return { duration: 0 };
    const w = node.offsetWidth;
    return { duration: 120, easing: cubicOut, css: (t) => `width:${t * w}px;overflow:hidden` };
  }

  /**
   * 창 가로 좌표 → 틈 자리(칸 가운데로 앞뒤를 가른다 — 핀 쪽 바깥이면 맨 앞, 런처 쪽이면 맨 뒤). 커서가 **지금 벌어진 틈(미리보기
   * 칸) 위**면 그 자리를 그대로 둔다 — 틈이 벌어지며 칸이 비켜서는 탓에 자리가 오락가락하지 않게.
   */
  function gapAt(x: number): string | null {
    const el = row;
    if (!el) return null;
    if (gap !== undefined) {
      const pv = el.querySelector<HTMLElement>(`[data-dock-fav-preview="${CSS.escape(gap ?? "")}"]`);
      const r = pv?.getBoundingClientRect();
      if (r && x >= r.left && x <= r.right) return gap;
    }
    const cells = [...el.querySelectorAll<HTMLElement>("[data-dock-fav]")].map((cell) => {
      const r = cell.getBoundingClientRect();
      return { id: cell.dataset.dockFav!, top: r.left, height: r.width };
    });
    return workspaceDropBefore(cells, x);
  }

  // ---------------------------------------------------------------------------
  // 끌어다 놓아 더하기(2026-10-23) — 사이드 독의 호스트 · 프로젝트 · DB 연결 줄(HTML5 끌기). 판 전체(`StatusBar` 의 `.floating-menu`)가
  // 이 셋을 부른다. **우리 짐일 때만** `preventDefault` · `stopPropagation` 한다 — 독 밖의 호스트 드롭(시작 타일 위 = 접속 ·
  // 타일 분할)은 그대로 산다(독은 `position: fixed` 판이라 독 위의 드롭만 여기 온다).
  // ---------------------------------------------------------------------------
  let flash = $state<{ keys: string[]; kind: "new" | "dup" } | null>(null);
  let flashTimer: ReturnType<typeof setTimeout> | null = null;

  function showFlash(keys: string[], kind: "new" | "dup"): void {
    if (flashTimer !== null) clearTimeout(flashTimer);
    flash = null;
    void tick().then(() => {
      flash = { keys, kind };
      flashTimer = setTimeout(() => { flash = null; flashTimer = null; }, kind === "new" ? 1000 : 600);
    });
  }

  /** 끌기를 거둔다 — 독이 접히거나 끌기가 끝나면 부른다 */
  export function clearDrop(): void {
    addDrag = null;
    if (!drag) gap = undefined;
  }

  export function dragOver(ev: DragEvent): void {
    const dt = ev.dataTransfer;
    const kind = favoriteDropKind(dt?.types);
    if (!dt || kind === null) return;
    ev.preventDefault();
    ev.stopPropagation();
    menu = null;
    if (favorites().length >= MAX_FAVORITES) {
      dt.dropEffect = "none";
      addDrag = { kind, full: true };
      gap = undefined;
      return;
    }
    dt.dropEffect = "copy";
    addDrag = { kind, full: false };
    gap = gapAt(ev.clientX);
  }

  export function dragLeave(ev: DragEvent): void {
    const to = ev.relatedTarget;
    if (to instanceof Node && ev.currentTarget instanceof Node && ev.currentTarget.contains(to)) return;
    clearDrop();
  }

  export function drop(ev: DragEvent): void {
    const dt = ev.dataTransfer;
    const kind = favoriteDropKind(dt?.types);
    if (!dt || kind === null) return;
    ev.preventDefault();
    ev.stopPropagation();
    const before = gap ?? null;
    const g = row;
    const lefts = g ? measureLefts(g) : null;
    const result = addDroppedFavorites(kind, (type) => dt.getData(type), before);
    // 새 칸은 자리 바꾸기와 같은 내려앉기로 선다(`playFlip` 의 pop — 이웃은 미리보기 칸 자리 그대로라 미끄러지지 않는다)
    const landed = result.added[0];
    if (landed && g && lefts) void tick().then(() => playFlip(g, lefts, favoriteKey(landed)));
    // 더해졌으면 틈은 움직임 없이 닫히고 그 자리에 진짜 칸이 선다 · 이미 있던 칸이면 틈이 닫히며 그 칸이 깜빡인다
    settle = result.added.length > 0;
    addDrag = null;
    gap = undefined;
    void tick().then(() => { settle = false; });
    if (result.added.length > 0) showFlash(result.added.map(favoriteKey), "new");
    else if (result.existing.length > 0) showFlash(result.existing.map(favoriteKey), "dup");
  }

  $effect(() => {
    // 끌기가 독 밖에서 끝나도(취소 · 다른 곳에 놓음) 틈을 거둔다
    const done = () => clearDrop();
    window.addEventListener("dragend", done, true);
    window.addEventListener("drop", done);
    return () => {
      window.removeEventListener("dragend", done, true);
      window.removeEventListener("drop", done);
      if (flashTimer !== null) clearTimeout(flashTimer);
    };
  });

  $effect(() => {
    busy = menu !== null || drag !== null;
  });

  function press(key: string): void {
    if (drag || performance.now() - dragEndedAt < 250) return;
    const fav = favs.find((f) => f.key === key);
    if (fav) openFavorite(fav, onconnect);
  }

  $effect(() => {
    const el = row;
    if (!el) return;
    const finish = () => {
      const d = drag;
      if (d?.moved) dragEndedAt = performance.now();
      drag = null;
      if (d && el.hasPointerCapture(d.pointerId)) el.releasePointerCapture(d.pointerId);
    };
    /** 끝내되 순서는 되돌린다(줄 밖에 놓음 · Esc · 취소) — 빈자리가 원래 자리로 미끄러져 돌아간다 */
    const revert = () => {
      const had = order !== null;
      finish();
      if (had) void flipRow(() => (order = null));
    };
    /** 놓아도 되는 자리인가 — 줄 둘레 24px 까지(독은 한 줄이라 조금 벗어나도 줄 위로 본다) */
    const inside = (x: number, y: number) => {
      const r = el.getBoundingClientRect();
      return x >= r.left - 24 && x <= r.right + 24 && y >= r.top - 24 && y <= r.bottom + 24;
    };
    /** 커서 x → 빈자리를 그 자리로 옮긴다(이웃은 FLIP 으로 비켜선다 — 설정 › 머리줄 칩과 같은 `$lib/flip`) */
    const reorder = (x: number) => {
      const d = drag;
      const cur = order;
      if (!d?.moved || !cur) return;
      const rest = cur.filter((k) => k !== d.key);
      const at = insertIndexAt(el, rest, x);
      const next = [...rest.slice(0, at), d.key, ...rest.slice(at)];
      if (next.join("\u0000") !== cur.join("\u0000")) void flipRow(() => (order = next));
    };
    const down = (ev: PointerEvent) => {
      if (ev.button !== 0 || drag) return;
      const cell = ev.target instanceof Element ? ev.target.closest<HTMLElement>("[data-dock-fav]") : null;
      if (!cell || !el.contains(cell)) return;
      menu = null;
      const r = cell.getBoundingClientRect();
      drag = {
        key: cell.dataset.dockFav!, pointerId: ev.pointerId, x: ev.clientX, y: ev.clientY, moved: false,
        px: ev.clientX, py: ev.clientY, ox: ev.clientX - r.left, oy: ev.clientY - r.top,
      };
    };
    const move = (ev: PointerEvent) => {
      const d = drag;
      if (!d || ev.pointerId !== d.pointerId) return;
      if (!d.moved && Math.max(Math.abs(ev.clientX - d.x), Math.abs(ev.clientY - d.y)) < 5) return;
      const first = !d.moved;
      if (first && ev.isTrusted) el.setPointerCapture(ev.pointerId);
      d.moved = true;
      d.px = ev.clientX;
      d.py = ev.clientY;
      ev.preventDefault();
      // 처음 움직인 순간 — 칸이 제자리에서 비고(`.lifted`) 그 빈자리가 커서를 따라 옮겨 다닌다
      if (first) order = [...favKeys];
      reorder(ev.clientX);
    };
    const up = (ev: PointerEvent) => {
      const d = drag;
      if (!d || ev.pointerId !== d.pointerId) return;
      if (!d.moved) return finish();
      if (!inside(ev.clientX, ev.clientY)) return revert();
      // 놓을 자리 = 빈자리가 지금 선 곳 — 그 뒤 칸 앞(맨 뒤면 `null`). 제자리면 `moveFavorite` 가 아무것도 바꾸지 않는다
      const cur = order ?? favKeys;
      const before = cur[cur.indexOf(d.key) + 1] ?? null;
      finish();
      void flipRow(() => {
        moveFavorite(d.key, before);
        order = null;
      }, d.key);
    };
    const cancel = (ev: PointerEvent) => { if (ev.pointerId === drag?.pointerId) revert(); };
    const escape = (ev: KeyboardEvent) => {
      if (ev.code !== "Escape" || !drag) return;
      ev.preventDefault();
      ev.stopPropagation();
      dragEndedAt = performance.now();
      revert();
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("lostpointercapture", cancel);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("blur", revert);
    window.addEventListener("keydown", escape, true);
    return () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("lostpointercapture", cancel);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("blur", revert);
      window.removeEventListener("keydown", escape, true);
      finish();
      order = null;
    };
  });

  /**
   * 칸 위의 키 — 메뉴 키 · `Shift+F10` 은 우클릭 메뉴(칸 위에), `Alt+←/→` 는 한 칸, `Home`/`End` 는 양 끝으로 옮긴다
   * (상태바 선두단과 같은 키). `Alt+화살표` 는 전역 타일 포커스 키라 여기서 멈춰 세운다 — 나머지
   * 키는 손대지 않는다.
   */
  function onKey(ev: KeyboardEvent, key: string): void {
    if (ev.ctrlKey || ev.metaKey) return;
    if (ev.key === "ContextMenu" || (ev.key === "F10" && ev.shiftKey)) {
      ev.preventDefault();
      ev.stopPropagation();
      const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
      openMenu(key, r.left, r.top - 44);
      return;
    }
    if (ev.shiftKey) return;
    const n = favKeys.length;
    const delta =
      ev.altKey && ev.code === "ArrowLeft" ? -1
      : ev.altKey && ev.code === "ArrowRight" ? 1
      : !ev.altKey && ev.code === "Home" ? -n
      : !ev.altKey && ev.code === "End" ? n
      : 0;
    if (delta === 0) return;
    ev.preventDefault();
    ev.stopPropagation();
    const to = moveTarget(favKeys, key, delta);
    if (!to) return;
    moveFavorite(key, to.to);
    // 다시 그려지면 눌렀던 단추가 포커스를 잃는다 — 옮긴 칸에 되돌려 준다(docs/log/2026-09-17-keyboard-reorder.md)
    void tick().then(() => focusCell(key));
  }
</script>

<!-- 끄는 것의 얼굴 아이콘 — 자리 바꾸기 = 그 칸 · 더하기 = 호스트 · 프로젝트 · DB 자리 아이콘(미리보기 칸 · 잔상이 같이 쓴다) -->
{#snippet dragIcon()}
      {#if movingFav?.kind === "host"}
        <HostIcon icon={iconOf(movingFav.host)} size={iconSize} fallback="server" color={colorOf(movingFav.host)} />
      {:else if movingFav?.kind === "project"}
        <ProjectIcon project={movingFav.project} size={iconSize} />
      {:else if movingFav?.kind === "db"}
        <HostIcon icon={DB_ENGINE_ICON[movingFav.conn.engine]} size={iconSize} />
      {:else if addDrag?.kind === "project"}
        <ProjectIcon project={null} size={iconSize} />
      {:else if addDrag?.kind === "db"}
        <UiIcon name="database" size={iconSize} />
      {:else}
        <HostIcon icon={null} size={iconSize} fallback="server" />
      {/if}
{/snippet}

<!-- 놓을 자리 미리보기 칸 — 끄는 것의 옅은 얼굴. `at` 은 틈 자리 -->
{#snippet preview(at: string)}
  <span class="dock-fav-preview" data-dock-fav-preview={at} aria-hidden="true" transition:grow>
    <span class="fav-face">{@render dragIcon()}</span>
  </span>
{/snippet}

<!-- 잔상 — 칸 자리 바꾸기 동안 커서를 따라다니는 떠 있는 칸(잡은 점이 커서에 붙는다). 창 좌표 `position: fixed` — 메뉴와 같은 자리 규칙 -->
{#if drag?.moved && movingFav}
  <span class="dock-fav-ghost" aria-hidden="true" style:left="{drag.px - drag.ox}px" style:top="{drag.py - drag.oy}px">
    <span class="fav-face">{@render dragIcon()}</span>
  </span>
{/if}

{#if addDrag?.full}
  <span class="dock-full-hint" role="status" data-dock-fav-full>{t("app.dock.favorites.full")}</span>
{/if}

{#if favs.length > 0 || gap !== undefined}
  <div class="dock-favs" class:grabbing={drag?.moved} role="group" aria-label={t("app.start.favorites.aria")} data-dock-favorites bind:this={row}>
    {#each shown as fav (fav.key)}
      {@const title = favoriteTitle(fav, t)}
      {#if gap === fav.key}{@render preview(fav.key)}{/if}
      <button
        type="button"
        class="dock-fav"
        class:lifted={drag?.key === fav.key && drag.moved}
        data-flip-id={fav.key}
        class:flash-new={flash?.kind === "new" && flash.keys.includes(fav.key)}
        class:flash-dup={flash?.kind === "dup" && flash.keys.includes(fav.key)}
        class:menued={menu?.key === fav.key}
        data-dock-fav={fav.key}
        {title}
        aria-label={title}
        onclick={() => press(fav.key)}
        oncontextmenu={(ev) => {
          ev.preventDefault();
          openMenu(fav.key, ev.clientX, ev.clientY);
        }}
        onkeydown={(ev) => onKey(ev, fav.key)}
      >
        <span class="fav-face" aria-hidden="true">
          {#if fav.kind === "host"}
            <HostIcon icon={iconOf(fav.host)} size={iconSize} fallback="server" color={colorOf(fav.host)} />
          {:else if fav.kind === "db"}
            <HostIcon icon={DB_ENGINE_ICON[fav.conn.engine]} size={iconSize} label={dbEngineLabel(fav.conn.engine)} />
          {:else}
            <ProjectIcon project={fav.project} size={iconSize} />
          {/if}
        </span>
        {#if isOpen(fav)}<span class="fav-open" data-dock-fav-open aria-hidden="true"></span>{/if}
      </button>
    {/each}
    {#if gap === null}{@render preview("")}{/if}
  </div>
{/if}

{#if menu}
  {@const target = favs.find((f) => f.key === menu?.key)}
  <div class="fav-menu-backdrop" role="presentation" onmousedown={() => closeMenu()}></div>
  <div class="fav-menu menu-surface" role="menu" tabindex="-1"
    aria-label={target ? t("app.start.favorite.menu.aria", { name: favoriteName(target) }) : t("app.start.favorites.aria")}
    bind:this={menuEl} style:left={menu.x + "px"} style:top={menu.y + "px"}
    onkeydown={(ev) => { if (ev.code === "Escape") { ev.preventDefault(); closeMenu(true); } ev.stopPropagation(); }}>
    <button type="button" class="menu-row danger" role="menuitem" data-dock-fav-remove
      onclick={removeFromMenu}>{t("app.statusbar.favorite.remove")}</button>
  </div>
{/if}

<style>
  /*
   * 칸 = 34×34 얼굴 하나(옛 워크스페이스 칸과 같은 치수 · 독의 `--sb-cell-*`). 칸이 많으면(최대 10) 이 줄만 가로로
   * 스크롤한다 — 포커스 링이 얼굴 밖으로 나가는 만큼 여백을 두고 같은 크기의 음수 바깥 여백으로 되돌린다.
   */
  .dock-favs {
    --fav-ring-gap: 2px;
    --fav-ring-w: 1.5px;
    --fav-ring-out: calc(var(--fav-ring-gap) + var(--fav-ring-w));
    /* `insertIndexAt` 이 칸의 offsetLeft 를 이 줄 기준으로 잰다 */
    position: relative;
    display: flex;
    align-items: center;
    gap: var(--sb-gap);
    min-width: 0;
    padding: var(--fav-ring-out);
    margin: calc(-1 * var(--fav-ring-out));
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: none;
  }
  .dock-fav {
    position: relative;
    flex: 0 0 auto;
    display: grid;
    place-items: center;
    padding: 0;
    color: var(--fg-2);
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    cursor: pointer;
    touch-action: none;
  }
  /* End-4 식 칸(2026-10-18) — 44px 원(2026-10-26 둥근 네모 14px → 원 · 알약 판 안) · surfaceContainerHigh 판, 호버(· 메뉴가 열린 칸)는 상태 층 */
  .fav-face {
    position: relative;
    box-sizing: border-box;
    display: grid;
    place-items: center;
    width: var(--sb-cell-w);
    height: var(--sb-cell-h);
    border-radius: 50%;
    background: var(--control-tile-bg);
    box-shadow: var(--glass-ctl-edge, none);
  }
  /* 열린 곳 점 — 칸 아래 가운데 primary 점(판 안쪽 바닥) */
  .fav-open {
    position: absolute;
    left: 50%;
    bottom: 3px;
    width: 4px;
    height: 4px;
    margin-left: -2px;
    border-radius: 50%;
    background: var(--accent);
    pointer-events: none;
  }
  .fav-face::after {
    content: "";
    position: absolute;
    inset: calc(-1 * var(--fav-ring-out));
    border: var(--fav-ring-w) solid transparent;
    border-radius: 50%;
    pointer-events: none;
    transition: border-color 120ms ease;
  }
  .dock-fav:hover,
  .dock-fav.menued {
    color: var(--fg-1);
  }
  .dock-fav:hover .fav-face,
  .dock-fav.menued .fav-face {
    background: var(--control-tile-bg-hover);
  }
  .dock-fav:focus-visible {
    outline: none;
  }
  .dock-fav:focus-visible .fav-face::after {
    border-color: var(--focus-ring);
  }
  /* 끄는 칸 — 자리(폭)만 남기고 사라진다. 그 빈자리가 커서를 따라 옮겨 다니며 곧 놓일 자리다(설정 › 머리줄 칩과 같다 · 10-23 사용자).
     들고 있는 것은 커서를 따라오는 잔상(`.dock-fav-ghost`)이다 */
  .dock-fav.lifted {
    visibility: hidden;
  }
  /* 놓은 직후 — 새 칸은 1초 강조색 테두리, 이미 있던 칸은 경고색으로 한 번 깜빡(테두리 색 전환은 위 `::after` 의 120ms) */
  .dock-fav.flash-new .fav-face::after {
    border-color: var(--accent);
  }
  .dock-fav.flash-dup .fav-face::after {
    border-color: var(--warn);
  }
  /* 놓을 자리 미리보기 칸 — 옅은 secondaryContainer 면 · 반투명(점선 · 삽입선 없음 — 사용자). 폭은 `grow` 가 0 ↔ 제 폭으로 */
  .dock-fav-preview {
    flex: 0 0 auto;
    display: block;
    width: var(--sb-cell-w);
    height: var(--sb-cell-h);
    opacity: 0.55;
    pointer-events: none;
  }
  /* 잔상 — 집어 든 칸: 살짝 커지고 기울어 그림자가 진다(놓을 자리 미리보기와 달리 진한 원래 얼굴). 눌림을 받지 않는다 */
  .dock-fav-ghost {
    position: fixed;
    z-index: 1;
    pointer-events: none;
    transform: scale(1.08) rotate(-4deg);
    opacity: 0.95;
  }
  .dock-fav-ghost .fav-face {
    box-shadow: var(--shadow-raised);
  }
  .dock-fav-ghost .fav-face::after {
    display: none;
  }
  /* 끄는 동안의 커서 — 포인터 캡처를 줄이 쥐므로 줄에 건다 */
  .dock-favs.grabbing,
  .dock-favs.grabbing * {
    cursor: grabbing;
  }
  .dock-fav-preview .fav-face {
    background: var(--control-sel-bg);
    color: var(--control-sel-fg);
  }
  .dock-fav-preview .fav-face::after {
    display: none;
  }
  /* 열 칸이 찼다 — 판 위 가운데의 작은 글자(끄는 동안만) */
  .dock-full-hint {
    position: absolute;
    left: 50%;
    bottom: calc(100% + 6px);
    transform: translateX(-50%);
    padding: 2px 10px;
    border-radius: 999px;
    font-size: var(--t-xs);
    color: var(--fg-2);
    background: var(--glass-float, var(--surface-raised-solid));
    box-shadow: var(--shadow-raised);
    white-space: nowrap;
    pointer-events: none;
  }
  .fav-menu-backdrop {
    position: fixed;
    inset: 0;
    z-index: 105;
  }
  .fav-menu {
    position: fixed;
    z-index: 106;
    min-width: 180px;
  }
</style>
