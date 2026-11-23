<script lang="ts">
  /**
   * 이미지 타일(`kind:"image"`) — 그림 파일 한 장을 보고 같은 폴더의 그림을 이전/다음으로 훑는다. 세션 빌리기 · 배치 · 창 이관은 파일 한 장 타일 공용 함수가 한다.
   * 받은 바이트는 Blob URL 로 `<img>` 에 그린다 — 자산 프로토콜 허용 범위를 넓히지 않고, SVG 도 `<img>` 로만 그린다(스크립트가 돌지 않는다).
   * 늦게 온 옛 답은 번호(`seq`)로 버린다 · 다른 경로를 읽을 때 그림을 언제 버리는지는 `image/picture-state` 가 정한다.
   * 하지 않는 것: 편집 · 회전 · 저장(파일을 바꾸지 않는다) · 전용 폰 화면(원격 창은 같은 화면을 그린다).
   */
  import { onDestroy, untrack } from "svelte";
  import UiIcon from "$lib/UiIcon.svelte";
  import ImageMenu from "$lib/ImageMenu.svelte";
  import ZoomMenu from "$lib/image/ZoomMenu.svelte";
  import type { FsBackend } from "$lib/fs-backend";
  import { imageMime } from "$lib/browser/preview";
  import { formatSize, isSessionGone, type SftpEntry } from "$lib/sftp-browser";
  import { stripReason } from "$lib/error-reason";
  import { isTransferCanceled, nextOp } from "$lib/fs-ops";
  import { pollIntervalOf, shouldPoll, stampChanged, type Stamp } from "$lib/doc-refresh";
  import { IMAGE_MAX_BYTES, imageReadPlan, progressRatio } from "$lib/image/read-plan";
  import { keepsOnFailure, keepsPicture, keepsWhileReading, pictureVisible, type ImagePhase } from "$lib/image/picture-state";
  import {
    imageBaseName,
    imageSiblings,
    neighborPath,
    siblingCounter,
    withoutCurrent,
    withoutEntry,
    type ImageSiblings,
  } from "$lib/image/neighbors";
  import { imageKeyAction, type ImageKeyAction } from "$lib/image/keys";
  import { counterMinCss, expandedSlot, fitBar, widestCounter, type NameBox } from "$lib/image/bar-fit";
  import {
    aboveFit,
    canPan,
    centerOnMap,
    fitScale,
    fitView,
    minimapRect,
    minimapSize,
    panBy,
    stepScale,
    wheelFactor,
    zoomAt,
    zoomCentered,
    zoomLabel,
    zoomPressed,
    type Point,
    type Size,
    type View,
  } from "$lib/image/view-math";
  import { minimapOn, setMinimapOn } from "$lib/image/minimap-pref.svelte.js";
  import { imageMenuActions, type ImageMenuAction, type ImageMenuExtra } from "$lib/image-menu";
  import { runImageAction } from "$lib/image-actions";
  import { isRemote } from "$lib/ipc";
  import { paneHeadShown, setPaneTools } from "$lib/pane/pane-tools.svelte.js";
  import { t } from "$lib/i18n/i18n.svelte.js";

  let {
    paneId,
    path,
    backend,
    alias = "",
    sourceGone = false,
    onpath,
    onnotice,
  }: {
    paneId: string;
    path: string;
    backend: FsBackend;
    alias?: string;
    sourceGone?: boolean;
    onpath: (path: string) => void;
    onnotice?: (message: string) => void;
  } = $props();

  // ── 읽기 ────────────────────────────────────────────────────────────────────

  let phase = $state<ImagePhase>("loading");
  /** 그리는 그림의 Blob 과 그 URL — 둘은 늘 함께 바뀐다 */
  let url = $state<string | null>(null);
  let blob = $state.raw<Blob | null>(null);
  let drawnPath = $state("");
  let drawnSize = $state(0);
  let natural = $state<Size | null>(null);
  let errorText = $state("");
  let progress = $state({ done: 0, total: 0 });
  let pendingSize = $state(0);
  let op: number | null = null;
  /** 늦게 온 답이 새 답을 덮지 않게 — 읽기마다 오른다 */
  let seq = 0;
  let stamp: Stamp | null = null;
  let polling = false;
  /** 날아가 있는 읽기의 번호(없으면 0) — 다시 읽기 박자가 겹쳐 보내지 않게(느린 원격 · 큰 그림) */
  let inflight = 0;
  /** [그래도 열기]를 누른 그 백엔드 · 경로 · 크기 — 같은 것이면 다시 묻지 않는다 */
  let confirmedKey: string | null = null;

  const offline = $derived(!backend.online);

  const msgOf = (e: unknown) => (e instanceof Error ? e.message : String(e));
  const keyOf = (p: string, size: number) => `${backend.key}\u0000${p}\u0000${size}`;

  function dropImage() {
    if (url) URL.revokeObjectURL(url);
    url = null;
    blob = null;
    natural = null;
    drawnPath = "";
    drawnSize = 0;
  }

  /** 같은 그림을 다시 읽었다 — 바이트만 바꿔 끼운다(배율 · 이동은 그대로) */
  function replaceImage(b: Blob, size: number) {
    if (url) URL.revokeObjectURL(url);
    blob = b;
    url = URL.createObjectURL(b);
    drawnSize = size;
  }

  /**
   * 다른 그림 — 화면 밖에서 먼저 풀어(`decode`) 그림 · 크기 · 맞춤 · 배율 글자를 한 번에 바꾼다(깜빡이지 않게). 풀지 못하면 "그리지 못함"(이전 그림은 버린다).
   */
  async function swapIn(my: number, b: Blob, p: string, size: number) {
    const next = URL.createObjectURL(b);
    let dims: Size | null = null;
    try {
      const probe = new Image();
      probe.src = next;
      await probe.decode();
      // SVG 는 크기를 모를 수 있다 — `onImageLoad` 와 같은 대체값
      dims = { w: probe.naturalWidth || 300, h: probe.naturalHeight || 150 };
    } catch {
      dims = null;
    }
    if (my !== seq) {
      URL.revokeObjectURL(next);
      return;
    }
    if (url) URL.revokeObjectURL(url);
    url = next;
    blob = b;
    drawnPath = p;
    drawnSize = size;
    fit = true;
    natural = dims;
    phase = dims ? "ready" : "broken";
  }

  /** 받는 중인 조각 읽기를 멈춘다 — 백엔드가 다음 조각에서 멈추고 `[cancelled]` 로 돌아온다 */
  function stopTransfer() {
    if (op === null) return;
    const which = op;
    op = null;
    void backend.cancel(which).catch(() => {});
  }

  async function load(p: string, opts: { confirmed?: boolean; silent?: boolean } = {}) {
    const my = ++seq;
    stopTransfer();
    inflight = my;
    try {
      await read(my, p, opts);
    } finally {
      if (inflight === my) inflight = 0;
    }
  }

  async function read(my: number, p: string, opts: { confirmed?: boolean; silent?: boolean }) {
    const be = backend;
    const failed = () => {
      if (!keepsOnFailure(drawnPath, p)) dropImage();
    };
    if (!opts.silent) {
      phase = "loading";
      errorText = "";
    }
    let st: SftpEntry;
    try {
      st = await be.stat(p);
    } catch (e) {
      if (my !== seq) return;
      const m = msgOf(e);
      if (isSessionGone(m)) {
        failed();
        if (url) phase = "ready";
        return;
      }
      dropImage();
      errorText = stripReason(m);
      phase = "missing";
      forgetGone(p);
      return;
    }
    if (my !== seq) return;
    if (st.kind === "dir" || (st.kind === "symlink" && st.linkIsDir)) {
      dropImage();
      errorText = "";
      phase = "missing";
      return;
    }
    const plan = imageReadPlan(st.size, opts.confirmed === true || confirmedKey === keyOf(p, st.size));
    if (plan === "too-large" || plan === "confirm") {
      dropImage();
      pendingSize = st.size;
      phase = plan === "confirm" ? "confirm" : "toolarge";
      return;
    }
    if (!keepsWhileReading(drawnPath, p, plan)) dropImage();
    try {
      let bytes: ArrayBuffer;
      if (plan === "direct") {
        bytes = await be.readPreview(p);
      } else {
        const mine = nextOp();
        op = mine;
        progress = { done: 0, total: st.size };
        phase = "progress";
        bytes = await be.readImage(p, mine, (pr) => {
          if (my === seq) progress = { done: pr.bytesDone, total: pr.bytesTotal || st.size };
        });
        if (op === mine) op = null;
      }
      if (my !== seq) return;
      const b = new Blob([bytes], { type: imageMime(p) ?? "" });
      stamp = { size: st.size, mtime: st.mtime };
      if (keepsPicture(drawnPath, p)) {
        replaceImage(b, st.size);
        // 다 읽으면 `<img>` 의 onload 가 "ready" 로 바꾼다(그리기 실패는 onerror 가 "broken")
        if (phase !== "ready") phase = "loading";
      } else {
        await swapIn(my, b, p, st.size);
      }
    } catch (e) {
      if (my !== seq) return;
      const m = msgOf(e);
      failed();
      if (isTransferCanceled(m)) {
        phase = "cancelled";
        return;
      }
      if (isSessionGone(m)) {
        if (url) phase = "ready";
        return;
      }
      errorText = stripReason(m);
      phase = "error";
    }
  }

  const reading = $derived(phase === "loading" || phase === "progress");
  /** 도구줄 ⟳ 만 — 빨리 끝나도 한 바퀴는 채운 뒤 바퀴 끝에서 멈춘다(브랜치 타일과 같은 규칙) */
  let spinning = $state(false);

  /** [다시 읽기] — 사람이 누른 것은 조용하지 않다(폴더 목록도 다시) */
  function reload() {
    if (offline || path === "") return;
    listing = null;
    void load(path, {});
    void syncSiblings(true);
  }

  function openAnyway() {
    confirmedKey = keyOf(path, pendingSize);
    void load(path, { confirmed: true });
  }

  function onImageLoad(ev: Event) {
    const el = ev.currentTarget as HTMLImageElement;
    // SVG 는 크기를 모를 수 있다(`viewBox` 만) — 그때는 그려진 크기 · 없으면 300×150(웹 기본)
    const w = el.naturalWidth || 300;
    const h = el.naturalHeight || 150;
    if (!natural || natural.w !== w || natural.h !== h) natural = { w, h };
    phase = "ready";
  }

  function onImageError() {
    phase = "broken";
  }

  $effect(() => {
    const p = path;
    void backend.key;
    if (!backend.online || p === "") return;
    untrack(() => void load(p, { silent: p === drawnPath && url !== null }));
  });

  $effect(() => {
    const ms = pollIntervalOf(backend.key);
    const id = setInterval(() => void poll(), ms);
    return () => clearInterval(id);
  });

  function isVisible(): boolean {
    if (document.visibilityState !== "visible") return false;
    return rootEl !== null && rootEl.getClientRects().length > 0;
  }

  async function poll() {
    const gate = {
      visible: isVisible(),
      online: backend.online,
      sourceGone,
      hasFile: url !== null,
      error: phase !== "ready",
      busy: polling || inflight !== 0,
    };
    if (!shouldPoll(gate) || path === "") return;
    polling = true;
    const my = seq;
    const p = path;
    try {
      const e = await backend.stat(p);
      if (my !== seq || p !== path) return;
      if (!stampChanged(stamp, { size: e.size, mtime: e.mtime })) return;
      void load(p, { silent: true });
    } catch (e) {
      // 지워졌다 · 권한 — "파일이 없습니다" 로 선다(끊김은 띠 몫)
      if (my !== seq || isSessionGone(msgOf(e))) return;
      dropImage();
      errorText = stripReason(msgOf(e));
      phase = "missing";
      forgetGone(p);
    } finally {
      polling = false;
    }
  }

  onDestroy(() => {
    seq++;
    stopTransfer();
    if (url) URL.revokeObjectURL(url);
  });

  // ── 같은 폴더의 그림 ──────────────────────────────────────────────────────────

  /** 마지막으로 읽은 폴더 목록 — 같은 폴더 안에서 옮겨 다닐 때는 다시 읽지 않는다(원격 `list` 왕복을 이동마다 더하지 않게) */
  let listing: { key: string; dir: string; entries: readonly SftpEntry[] } | null = null;
  let siblings = $state.raw<ImageSiblings>({ list: [], index: -1 });
  let listSeq = 0;

  async function syncSiblings(force = false) {
    const p = path;
    const be = backend;
    if (p === "" || !be.online) return;
    const dir = be.parentOf(p);
    const my = ++listSeq;
    if (force || !listing || listing.key !== be.key || listing.dir !== dir) {
      try {
        const entries = await be.list(dir);
        if (my !== listSeq) return;
        // 읽는 사이 지금 그림이 없어졌다고 판정됐으면 그것은 빼고 둔다(늦게 온 목록이 다시 세지 않게)
        listing = { key: be.key, dir, entries: phase === "missing" ? withoutEntry(entries, p, be.sep === "\\") : entries };
      } catch {
        if (my !== listSeq) return;
        listing = null;
        siblings = { list: [], index: -1 };
        return;
      }
    }
    siblings = imageSiblings(listing.entries, p, be.sep === "\\");
  }

  /**
   * 지금 그림이 "파일 없음"이 됐다 — 캐시된 폴더 목록에서도 뺀다. 빼지 않으면 다른 그림으로 옮기는 순간 지운 그림을 다시 세고 ← 로 되돌아간다.
   */
  function forgetGone(p: string) {
    const be = backend;
    if (!listing || listing.key !== be.key || listing.dir !== be.parentOf(p)) return;
    const entries = withoutEntry(listing.entries, p, be.sep === "\\");
    if (entries === listing.entries) return;
    listing = { ...listing, entries };
    siblings = imageSiblings(entries, p, be.sep === "\\");
  }

  $effect(() => {
    void path;
    void backend.key;
    void backend.online;
    untrack(() => void syncSiblings());
  });

  const navList = $derived(phase === "missing" ? withoutCurrent(siblings, path) : siblings);
  const counter = $derived(siblingCounter(navList));
  const prevPath = $derived(neighborPath(navList, -1));
  const nextPath = $derived(neighborPath(navList, 1));
  const hasNav = $derived(counter !== null || prevPath !== null || nextPath !== null);

  function go(dir: 1 | -1) {
    const to = dir < 0 ? prevPath : nextPath;
    if (to) onpath(to);
  }

  // ── 보기 ────────────────────────────────────────────────────────────────────

  let rootEl = $state<HTMLDivElement | null>(null);
  let stageEl = $state<HTMLDivElement | null>(null);
  let box = $state<Size>({ w: 0, h: 0 });
  let tileW = $state(0);
  let fit = $state(true);
  let free = $state<View>({ scale: 1, x: 0, y: 0 });

  $effect(() => {
    const el = stageEl;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      box = { w: el.clientWidth, h: el.clientHeight };
    });
    ro.observe(el);
    box = { w: el.clientWidth, h: el.clientHeight };
    return () => ro.disconnect();
  });

  $effect(() => {
    const el = rootEl;
    if (!el) return;
    const ro = new ResizeObserver(() => (tileW = el.clientWidth));
    ro.observe(el);
    tileW = el.clientWidth;
    return () => ro.disconnect();
  });

  const view = $derived<View>(natural ? (fit ? fitView(natural, box) : free) : { scale: 1, x: 0, y: 0 });
  const fitS = $derived(natural ? fitScale(natural, box) : 1);
  const narrow = $derived(tileW > 0 && tileW < 440);
  const pannable = $derived(natural !== null && !fit && canPan(view, natural, box));
  const mapShown = $derived(minimapOn() && natural !== null && !fit && aboveFit(view.scale, natural, box));

  $effect(() => {
    const b = box;
    untrack(() => {
      if (!fit && natural) free = panBy(free, natural, b, 0, 0);
    });
  });

  function setFit() {
    fit = true;
  }

  function zoomTo(scale: number, at?: Point) {
    if (!natural) return;
    free = at ? zoomAt(view, natural, box, scale, at) : zoomCentered(view, natural, box, scale);
    fit = false;
  }

  function stagePoint(ev: { clientX: number; clientY: number }): Point {
    const r = stageEl?.getBoundingClientRect();
    return r ? { x: ev.clientX - r.left, y: ev.clientY - r.top } : { x: box.w / 2, y: box.h / 2 };
  }

  /** 휠 — 커서 자리 기준. 수동 리스너(`passive: false`)로 걸어야 페이지 스크롤을 막을 수 있다 */
  function wheel(node: HTMLElement) {
    const on = (ev: WheelEvent) => {
      if (!natural || phase !== "ready") return;
      ev.preventDefault();
      zoomTo(view.scale * wheelFactor(ev.deltaY), stagePoint(ev));
    };
    node.addEventListener("wheel", on, { passive: false });
    return { destroy: () => node.removeEventListener("wheel", on) };
  }

  let drag: { id: number; x: number; y: number } | null = $state(null);
  function onPointerDown(ev: PointerEvent) {
    rootEl?.focus({ preventScroll: true });
    if (ev.button !== 0 || !pannable) return;
    drag = { id: ev.pointerId, x: ev.clientX, y: ev.clientY };
    (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);
    ev.preventDefault();
  }
  function onPointerMove(ev: PointerEvent) {
    if (!drag || drag.id !== ev.pointerId || !natural) return;
    free = panBy(free, natural, box, ev.clientX - drag.x, ev.clientY - drag.y);
    drag = { id: drag.id, x: ev.clientX, y: ev.clientY };
  }
  function onPointerUp(ev: PointerEvent) {
    if (drag?.id === ev.pointerId) drag = null;
  }

  function onDblClick(ev: MouseEvent) {
    if (!natural) return;
    if (fit) zoomTo(1, stagePoint(ev));
    else setFit();
  }

  function runKey(action: ImageKeyAction) {
    switch (action) {
      case "prev":
        return go(-1);
      case "next":
        return go(1);
      case "fit":
        return setFit();
      case "actual":
        return zoomTo(1);
      case "zoomIn":
        return zoomTo(stepScale(view.scale, 1));
      case "zoomOut":
        return zoomTo(stepScale(view.scale, -1));
      case "minimap":
        return setMinimapOn(!minimapOn());
    }
  }

  function onkeydown(ev: KeyboardEvent) {
    // 타일의 키보드 몸에 포커스가 있을 때만 — 안쪽 단추 · 메뉴에서 친 키는 그쪽 몫이다(도구줄 단추는 `onBarKey`)
    if (ev.target !== rootEl && ev.target !== stageEl) return;
    const action = imageKeyAction(ev);
    if (action === null) return;
    ev.preventDefault();
    runKey(action);
  }

  /**
   * 이 타일의 조작 뒤 키보드를 타일의 몸(`.image`)으로 돌려놓는다 — 아니면 누른 단추에 포커스가 남거나 `<body>` 로 떨어져 몸에서만 듣는 키가 먹지 않는다.
   */
  function backToBody() {
    rootEl?.focus({ preventScroll: true });
  }

  const act = (fn: () => void) => () => {
    fn();
    backToBody();
  };

  /**
   * 도구줄 단추에 포커스가 있을 때도 같은 키를 받는다 — 머리줄 도구줄은 몸 밖(`.pane-tools`)이라 몸의 `onkeydown` 에 닿지 않는다.
   */
  function onBarKey(ev: KeyboardEvent) {
    if (!(ev.target instanceof HTMLButtonElement)) return;
    const action = imageKeyAction(ev);
    if (action === null) return;
    ev.preventDefault();
    ev.stopPropagation();
    runKey(action);
    backToBody();
  }

  // ── 작은 지도 ─────────────────────────────────────────────────────────────────

  const mapSize = $derived(natural ? minimapSize(natural, narrow ? 112 : 160) : { w: 0, h: 0 });
  const mapRect = $derived(natural ? minimapRect(view, natural, box, mapSize) : { x: 0, y: 0, w: 0, h: 0 });
  let mapDrag: number | null = null;
  function mapAt(ev: PointerEvent) {
    if (!natural) return;
    const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    free = centerOnMap(view, natural, box, mapSize, { x: ev.clientX - r.left, y: ev.clientY - r.top });
  }
  function onMapDown(ev: PointerEvent) {
    if (ev.button !== 0) return;
    mapDrag = ev.pointerId;
    (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);
    ev.preventDefault();
    ev.stopPropagation();
    mapAt(ev);
  }
  function onMapMove(ev: PointerEvent) {
    if (mapDrag === ev.pointerId) mapAt(ev);
  }
  function onMapUp(ev: PointerEvent) {
    if (mapDrag === ev.pointerId) mapDrag = null;
  }

  // ── 칩 · 머리줄 ───────────────────────────────────────────────────────────────

  const extOf = (p: string) => {
    const name = imageBaseName(p);
    const at = name.lastIndexOf(".");
    return at > 0 ? name.slice(at + 1).toUpperCase() : "";
  };
  const facts = $derived(
    natural && drawnPath
      ? [`${natural.w} × ${natural.h}`, formatSize(drawnSize), extOf(drawnPath)].filter((s) => s !== "").join(" · ")
      : "",
  );
  const pct = $derived(zoomLabel(natural ? view.scale : null));
  const pressed = $derived(zoomPressed(natural !== null, fit, view.scale));
  const inHead = $derived(paneHeadShown(paneId));
  /**
   * 도구줄 상자의 폭 — 판정은 펼친 머리줄 · 이름이 최대 폭까지 가져간 때의 폭으로 센다(`expandedSlot`) — 잰 폭을 그대로 쓰면 이전/다음이 튄다.
   */
  let barW = $state(0);

  /**
   * 머리줄 이름 묶음(`.pane-ident`)의 지금 폭 · 최대 폭 — 최대 폭은 CSS `max-width`(도구줄이 선 머리줄은 `40%`)를 그대로 읽는다.
   * 묶음이 없거나(파일 타일 `.gone`) 최대가 없으면(쿼리 타일 무리 고정 `none`) 깎지 않는다.
   */
  function nameBox(head: HTMLElement): NameBox | null {
    const ident = head.querySelector<HTMLElement>(".pane-ident");
    if (!ident) return null;
    const cs = getComputedStyle(ident);
    if (cs.display === "none") return null;
    let maxWidth: number;
    if (cs.maxWidth.endsWith("%")) {
      const hs = getComputedStyle(head);
      const inner = head.clientWidth - (parseFloat(hs.paddingLeft) || 0) - (parseFloat(hs.paddingRight) || 0);
      maxWidth = (inner * parseFloat(cs.maxWidth)) / 100;
    } else if (cs.maxWidth.endsWith("px")) {
      maxWidth = parseFloat(cs.maxWidth);
    } else {
      return null;
    }
    return { width: ident.getBoundingClientRect().width, maxWidth };
  }

  function measureBar(node: HTMLElement) {
    const head = node.closest<HTMLElement>(".pane-head");
    const read = () => {
      const heads = head
        ? Array.from(head.querySelectorAll<HTMLElement>(":scope > .head-btn"), (b) => ({
            width: b.getBoundingClientRect().width,
            marginLeft: parseFloat(getComputedStyle(b).marginLeft) || 0,
          }))
        : [];
      barW = expandedSlot(node.getBoundingClientRect().width, heads, head ? nameBox(head) : null);
    };
    const ro = new ResizeObserver(read);
    ro.observe(node);
    read();
    return { destroy: () => ro.disconnect() };
  }
  const counterText = $derived(counter ? `${counter.at} / ${counter.total}` : null);
  /** 안쪽 여백을 뺀 폭 — 머리줄 안 `.bar.inhead` 는 왼쪽 4, 몸 위 `.bar` 는 양옆 6 */
  const fits = $derived(
    fitBar(
      barW > 0 ? Math.max(1, barW - (inHead ? 4 : 12)) : 0,
      hasNav ? (counter ? widestCounter(counter.total) : "") : null,
      pct,
    ),
  );
  const navOut = $derived(narrow || !fits.nav);

  let zoomMenu = $state<{ x: number; y: number } | null>(null);
  function openZoomMenu(ev: MouseEvent) {
    const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    zoomMenu = { x: r.right, y: r.bottom + 4 };
  }
  function pickZoom(choice: "fit" | number) {
    if (choice === "fit") setFit();
    else zoomTo(choice);
    rootEl?.focus({ preventScroll: true });
  }

  $effect(() => {
    const id = paneId;
    return setPaneTools(id, { bar: imageBar, nameTip: () => (path ? (alias ? `${alias}:${path}` : path) : null) });
  });

  // ── 본문 우클릭 ───────────────────────────────────────────────────────────────

  let bodyMenu = $state<{ x: number; y: number; el: HTMLImageElement | null } | null>(null);
  let imgEl = $state<HTMLImageElement | null>(null);

  function onContextMenu(ev: MouseEvent) {
    ev.preventDefault();
    ev.stopPropagation();
    bodyMenu = { x: ev.clientX, y: ev.clientY, el: imgEl };
  }

  const bodyActions = $derived<ImageMenuAction[]>(blob ? imageMenuActions("file", isRemote) : []);
  const bodyBefore = $derived<ImageMenuExtra[]>([
    { id: "fit", label: t("files.image.fit"), disabled: natural === null },
    { id: "actual", label: t("files.image.actual"), disabled: natural === null },
  ]);
  const bodyAfter = $derived<ImageMenuExtra[]>([
    ...(backend.canOpenExternal ? [{ id: "external", label: t("files.menu.openexternal") }] : []),
    ...(backend.canEdit ? [{ id: "edit", label: t("files.menu.edit.external"), disabled: offline }] : []),
    ...(backend.canReveal ? [{ id: "reveal", label: t("files.doc.md.image.menu.reveal") }] : []),
  ]);

  function pickBody(action: ImageMenuAction) {
    const b = blob;
    const p = drawnPath;
    if (!b || !p) return;
    runImageAction(action, { kind: "file", path: p, mime: b.type, read: () => b.arrayBuffer() }, bodyMenu?.el ?? imgEl);
  }

  function pickExtra(id: string) {
    if (id === "fit") setFit();
    else if (id === "actual") zoomTo(1);
    else if (id === "external") void openExternally();
    else if (id === "edit") void editRemote();
    else if (id === "reveal") void reveal();
  }

  async function openExternally() {
    try {
      await backend.openExternal?.(path);
    } catch (e) {
      onnotice?.(stripReason(msgOf(e)));
    }
  }

  async function editRemote() {
    if (offline || !backend.edit) return;
    try {
      const name = await backend.edit(path);
      onnotice?.(t("files.browser.edit.opened", { name }));
    } catch (e) {
      onnotice?.(stripReason(msgOf(e)));
    }
  }

  async function reveal() {
    try {
      await backend.reveal?.(path);
    } catch (e) {
      onnotice?.(stripReason(msgOf(e)));
    }
  }
</script>

{#snippet externalButton()}
  {#if backend.canOpenExternal}
    <button type="button" class="retry" onclick={() => void openExternally()}>{t("files.menu.openexternal")}</button>
  {:else if backend.canEdit}
    <button type="button" class="retry" disabled={offline} onclick={() => void editRemote()}>{t("files.menu.edit.external")}</button>
  {/if}
{/snippet}

{#snippet imageBar(head: boolean)}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="bar" class:inhead={head} use:measureBar onkeydown={onBarKey}>
    <span class="grow" aria-hidden="true"></span>
    {#if !navOut && hasNav}
      <div class="nav" data-head-act role="group" aria-label={t("files.image.aria")}>
        <button
          type="button"
          class="btn ico"
          disabled={!prevPath}
          title={t("files.image.prev")}
          aria-label={t("files.image.prev")}
          onclick={act(() => go(-1))}><UiIcon name="chevron-left" size={14} /></button
        >
        <span class="count" data-image-counter style:min-width={counter ? counterMinCss(counter.total) : null}
          >{counterText ?? ""}</span
        >
        <button
          type="button"
          class="btn ico"
          disabled={!nextPath}
          title={t("files.image.next")}
          aria-label={t("files.image.next")}
          onclick={act(() => go(1))}><UiIcon name="chevron" size={14} /></button
        >
      </div>
    {/if}
    {#if !narrow && fits.seg}
      <div class="seg" data-head-act role="group" aria-label={t("files.image.zoom")}>
        <button
          type="button"
          class="btn txt"
          class:on={pressed.fit}
          aria-pressed={pressed.fit}
          disabled={natural === null}
          title={t("files.image.fit")}
          onclick={act(setFit)}>{t("files.image.fit")}</button
        >
        <button
          type="button"
          class="btn txt"
          class:on={pressed.actual}
          aria-pressed={pressed.actual}
          disabled={natural === null}
          title={t("files.image.actual")}
          aria-label={t("files.image.actual")}
          onclick={act(() => zoomTo(1))}>1:1</button
        >
      </div>
    {/if}
    <button
      type="button"
      class="btn pct"
      data-head-act
      disabled={natural === null}
      aria-haspopup="menu"
      aria-expanded={zoomMenu !== null}
      title={t("files.image.zoom")}
      aria-label={t("files.image.zoom.aria", { pct })}
      data-image-zoom
      onclick={openZoomMenu}
      ><span class="pct-txt"><span>{pct}</span><span class="pct-sizer" aria-hidden="true">100%</span></span><UiIcon
        name="chevron-down"
        size={12}
      /></button
    >
    {#if !narrow && fits.reload}
      <button
        type="button"
        class="btn ico refresh"
        class:spinning
        data-head-act
        disabled={offline || reading}
        title={t("files.image.reload")}
        aria-label={t("files.image.reload")}
        aria-busy={reading}
        onclick={act(() => {
          spinning = true;
          reload();
        })}
        onanimationiteration={() => {
          if (!reading) spinning = false;
        }}><UiIcon name="refresh" size={13} /></button
      >
    {/if}
  </div>
{/snippet}

<!-- `data-tile-focus` — 이 상자가 타일의 키보드 몸이다(`routeTileFocus` 가 여기 포커스를 준다) -->
<div
  class="image"
  role="presentation"
  tabindex="-1"
  data-tile-focus
  bind:this={rootEl}
  {onkeydown}
>
  {#if !inHead}{@render imageBar(false)}{/if}

  {#if sourceGone}
    <p class="banner gone">{t("files.browser.source.gone")}</p>
  {:else if offline}
    <p class="banner wait" data-image-offline>{t("files.image.offline")}{alias ? ` (${alias})` : ""}</p>
  {/if}

  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="stage"
    class:grab={pannable}
    class:grabbing={drag !== null}
    bind:this={stageEl}
    use:wheel
    onpointerdown={onPointerDown}
    onpointermove={onPointerMove}
    onpointerup={onPointerUp}
    onpointercancel={onPointerUp}
    ondblclick={onDblClick}
    oncontextmenu={onContextMenu}
  >
    {#if pictureVisible(phase, url !== null)}
      <img
        bind:this={imgEl}
        class="pic"
        class:dim={offline || sourceGone}
        class:hidden={natural === null}
        src={url}
        alt={imageBaseName(drawnPath)}
        draggable="false"
        style:width="{(natural?.w ?? 0) * view.scale}px"
        style:height="{(natural?.h ?? 0) * view.scale}px"
        style:transform="translate({view.x}px, {view.y}px)"
        onload={onImageLoad}
        onerror={onImageError}
      />
    {/if}

    {#if phase === "progress"}
      <div class="panel" role="status" data-image-progress>
        <span class="title">{t("files.image.loading")}</span>
        <span class="track" aria-hidden="true"><span class="fill" style:width="{progressRatio(progress.done, progress.total) * 100}%"></span></span>
        <span class="sub">{t("files.image.progress", { done: formatSize(progress.done), total: formatSize(progress.total) })}</span>
        <button type="button" class="retry" onclick={act(stopTransfer)}>{t("files.image.cancel")}</button>
      </div>
    {:else if phase === "confirm"}
      <div class="panel" role="alert" data-image-confirm>
        <span class="title">{t("files.image.huge")}</span>
        <span class="sub">{formatSize(pendingSize)}</span>
        <span class="acts">
          <button type="button" class="retry primary" onclick={act(openAnyway)}>{t("files.image.huge.open")}</button>
          {@render externalButton()}
        </span>
      </div>
    {:else if phase === "toolarge"}
      <div class="panel" role="alert">
        <span class="title">{t("files.image.toolarge", { limit: formatSize(IMAGE_MAX_BYTES) })}</span>
        <span class="sub">{formatSize(pendingSize)}</span>
        <span class="acts">{@render externalButton()}</span>
      </div>
    {:else if phase === "broken"}
      <div class="panel" role="alert" data-image-broken>
        <UiIcon name="image" size={28} />
        <span class="title">{t("files.image.broken")}</span>
        <span class="acts">{@render externalButton()}</span>
      </div>
    {:else if phase === "missing"}
      <div class="panel" role="alert" data-image-missing>
        <span class="title">{t("files.image.missing")}</span>
        {#if errorText}<span class="sub">{errorText}</span>{/if}
        <button type="button" class="retry" disabled={offline} onclick={act(reload)}>{t("files.image.reload")}</button>
      </div>
    {:else if phase === "error"}
      <div class="panel" role="alert">
        <span class="title">{t("files.image.error")}</span>
        {#if errorText}<span class="sub">{errorText}</span>{/if}
        <button type="button" class="retry" disabled={offline} onclick={act(reload)}>{t("files.image.reload")}</button>
      </div>
    {:else if phase === "cancelled"}
      <div class="panel" role="status">
        <span class="title">{t("files.image.cancelled")}</span>
        <button type="button" class="retry" disabled={offline} onclick={act(reload)}>{t("files.image.reload")}</button>
      </div>
    {/if}

    {#if navOut && hasNav && (phase === "ready" || phase === "missing")}
      <button
        type="button"
        class="side prev"
        disabled={!prevPath}
        title={t("files.image.prev")}
        aria-label={t("files.image.prev")}
        onpointerdown={(e) => e.stopPropagation()}
        ondblclick={(e) => e.stopPropagation()}
        onclick={act(() => go(-1))}><UiIcon name="chevron-left" size={18} /></button
      >
      <button
        type="button"
        class="side next"
        disabled={!nextPath}
        title={t("files.image.next")}
        aria-label={t("files.image.next")}
        onpointerdown={(e) => e.stopPropagation()}
        ondblclick={(e) => e.stopPropagation()}
        onclick={act(() => go(1))}><UiIcon name="chevron" size={18} /></button
      >
    {/if}

    {#if facts && phase === "ready"}
      <!-- `3 / 12 · ` 의 끝 칸은 식(`{…}`)으로 넣는다 — 글자 그대로 쓰면 Svelte 가 요소 끝의 공백을 지운다(`8 / 11 ·1280 × 720`) -->
      <span class="facts" class:center={navOut} data-image-facts
        >{#if navOut && counterText}<span class="pos" data-image-facts-pos>{`${counterText} · `}</span>{/if}{facts}</span
      >
    {/if}

    {#if mapShown && url && phase === "ready"}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="map"
        style:width="{mapSize.w}px"
        style:height="{mapSize.h}px"
        data-image-minimap
        onpointerdown={onMapDown}
        onpointermove={onMapMove}
        onpointerup={onMapUp}
        onpointercancel={onMapUp}
        ondblclick={(e) => e.stopPropagation()}
        oncontextmenu={(e) => e.stopPropagation()}
      >
        <img class="map-pic" src={url} alt="" draggable="false" />
        <span
          class="map-rect"
          style:left="{mapRect.x}px"
          style:top="{mapRect.y}px"
          style:width="{mapRect.w}px"
          style:height="{mapRect.h}px"
        ></span>
        <button
          type="button"
          class="map-close"
          title={t("files.image.minimap.close")}
          aria-label={t("files.image.minimap.close")}
          onpointerdown={(e) => e.stopPropagation()}
          onclick={act(() => setMinimapOn(false))}><UiIcon name="close" size={12} /></button
        >
      </div>
    {/if}
  </div>
</div>

{#if zoomMenu}
  <ZoomMenu
    x={zoomMenu.x}
    y={zoomMenu.y}
    {fit}
    scale={view.scale}
    minimap={minimapOn()}
    onpick={pickZoom}
    onminimap={setMinimapOn}
    onclose={(refocus) => {
      zoomMenu = null;
      if (refocus) backToBody();
    }}
  />
{/if}

{#if bodyMenu}
  <ImageMenu
    actions={bodyActions}
    x={bodyMenu.x}
    y={bodyMenu.y}
    before={bodyBefore}
    after={bodyAfter}
    onextra={pickExtra}
    onclose={() => (bodyMenu = null)}
    onpick={pickBody}
  />
{/if}

<style>
  .image {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    outline: none;
    /* 다른 크롬 타일과 같은 바탕 · 글래스 크롬 타일이면 판은 타일 상자가 한 번 칠한다 — 여기는 `--tile-inner`(투명 · `PaneHost`) */
    background: var(--tile-inner, var(--bg-panel));
  }

  /* ── 도구줄 ── */
  .bar {
    display: flex;
    align-items: center;
    gap: 4px;
    flex: 0 0 auto;
    padding: 5px 6px;
    border-bottom: 1px solid var(--border);
  }

  .bar.inhead {
    flex: 1 1 0;
    min-width: 0;
    padding: 0 0 0 4px;
    border-bottom: none;
    --head-act-gap: 4px;
  }

  .grow {
    flex: 1 1 auto;
    min-width: 0;
  }

  .nav,
  .seg {
    display: inline-flex;
    flex: 0 0 auto;
    align-items: center;
    gap: 2px;
  }

  .seg {
    margin-left: 4px;
  }

  .count {
    min-width: 3.2em;
    font-family: var(--font-ui);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    color: var(--fg-muted);
    text-align: center;
    white-space: nowrap;
  }

  .btn {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 2px;
    height: 24px;
    padding: 0 7px;
    font-family: var(--font-ui);
    font-size: 11px;
    line-height: 1;
    color: var(--fg-muted);
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    cursor: pointer;
  }

  .btn:hover:not(:disabled) {
    color: var(--fg);
    background: var(--bg-hover);
  }

  .btn:focus-visible {
    outline: 1px solid var(--accent);
    outline-offset: -1px;
  }

  .btn:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .btn.ico {
    width: 24px;
    padding: 0;
  }

  /* 도는 동안은 흐리지 않는다 — 눌러서 돌고 있다는 것이 곧 응답이다 */
  .btn.refresh.spinning {
    opacity: 1;
  }

  .btn.refresh.spinning :global(svg) {
    animation: image-spin 0.9s linear infinite;
  }

  @keyframes image-spin {
    to {
      transform: rotate(360deg);
    }
  }

  /* 움직임 줄임이면 돌리지 않고 흐리게만 — 바퀴 끝 이벤트가 없으니 흐림은 `aria-busy` 를 따른다 */
  @media (prefers-reduced-motion: reduce) {
    .btn.refresh.spinning :global(svg) {
      animation: none;
    }
    .btn.refresh.spinning {
      opacity: 0.4;
    }
    .btn.refresh.spinning:not([aria-busy="true"]) {
      opacity: 1;
    }
  }

  /* 배율 글자 칸은 보이지 않는 `100%`(`.pct-sizer`)와 같은 격자 칸에 겹쳐 늘 그만큼 넓다 — 넘길 때 단추 폭이 바뀌어 이전/다음이 움직이지 않게.
     폭을 바꾸면 `image/bar-fit` 의 `PCT_TEXT_MIN` 도 함께 */
  .btn.pct {
    padding: 0 4px 0 6px;
    font-variant-numeric: tabular-nums;
  }

  .pct-txt {
    display: inline-grid;
    justify-items: end;
  }

  .pct-txt > span {
    grid-area: 1 / 1;
    white-space: nowrap;
  }

  .pct-sizer {
    visibility: hidden;
  }

  .seg .btn {
    border-radius: 999px;
  }

  .btn.on {
    color: var(--fg);
    background: var(--accent-soft);
  }

  /* ── 띠 ── */
  .banner {
    flex: 0 0 auto;
    margin: 0;
    padding: 6px 10px;
    font-size: 11px;
    line-height: 1.4;
    border-bottom: 1px solid var(--border);
  }

  .banner.wait {
    color: var(--warn);
    background: var(--warn-soft);
  }

  .banner.gone {
    color: var(--err);
    background: var(--err-soft);
  }

  /* ── 무대 ── */
  .stage {
    position: relative;
    flex: 1 1 auto;
    min-height: 0;
    overflow: hidden;
    user-select: none;
    touch-action: none;
  }

  .stage.grab {
    cursor: grab;
  }

  .stage.grabbing {
    cursor: grabbing;
  }

  .pic {
    position: absolute;
    top: 0;
    left: 0;
    max-width: none;
    transform-origin: 0 0;
    image-rendering: auto;
    pointer-events: none;
  }

  .pic.hidden {
    visibility: hidden;
  }

  /* 끊긴 동안 — 마지막 그림을 흐리게 남긴다 */
  .pic.dim {
    opacity: 0.4;
  }

  /* 빈 화면 · 진행 · 묻기 — 무대 가운데 한 덩이 */
  .panel {
    position: absolute;
    top: 50%;
    left: 50%;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    width: min(320px, calc(100% - 32px));
    padding: 14px 16px;
    font-family: var(--font-ui);
    font-size: 12px;
    color: var(--fg-muted);
    text-align: center;
    background: var(--surface-raised-solid);
    border: 1px solid var(--line);
    border-radius: var(--radius-surface);
    box-shadow: var(--shadow-raised);
    transform: translate(-50%, -50%);
  }

  .panel .title {
    color: var(--fg);
    overflow-wrap: anywhere;
  }

  .panel .sub {
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    color: var(--fg-3);
    overflow-wrap: anywhere;
  }

  .track {
    position: relative;
    width: 100%;
    height: 4px;
    overflow: hidden;
    background: var(--surface-hover);
    border-radius: 999px;
  }

  .fill {
    position: absolute;
    inset: 0 auto 0 0;
    background: var(--accent);
    border-radius: 999px;
  }

  .acts {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 8px;
  }

  .retry {
    flex: 0 0 auto;
    padding: 3px 10px;
    font-family: var(--font-ui);
    font-size: 11px;
    color: var(--fg);
    background: transparent;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    cursor: pointer;
  }

  .retry:hover:not(:disabled) {
    background: var(--bg-hover);
  }

  .retry:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .retry.primary {
    color: var(--on-accent);
    background: var(--accent);
    border-color: transparent;
  }

  .retry.primary:hover {
    background: var(--accent-hover);
  }

  /* 칩 — 해상도 · 크기 · 형식 */
  .facts {
    position: absolute;
    left: 8px;
    bottom: 8px;
    max-width: calc(100% - 16px);
    padding: 2px 8px;
    overflow: hidden;
    font-family: var(--font-ui);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    color: var(--fg-muted);
    text-overflow: ellipsis;
    white-space: nowrap;
    background: var(--surface-raised);
    border: 1px solid var(--line);
    border-radius: 999px;
    pointer-events: none;
  }

  .facts.center {
    left: 50%;
    transform: translateX(-50%);
  }

  /*
   * 칩 앞 `3 / 12` — 머리줄 도구줄(`data-head-act`)과 같은 조건으로 포커스 밖이면 접는다 · 셀렉터는 `pane/PaneHeader.svelte` 의 "드러냄" 규칙 그대로다.
   */
  .facts {
    interpolate-size: allow-keywords;
  }

  .facts .pos {
    display: inline-block;
    overflow: hidden;
    vertical-align: top;
    /* 끝 칸(` · ` 뒤 공백 — 마크업에서 식으로 넣는다)이 inline-block 줄 끝에서 지워지지 않게 · 접히면 폭 0 이라 남지 않는다 */
    white-space: pre;
    transition:
      opacity 120ms ease-out,
      width 120ms ease-out;
  }

  @media (hover: hover) {
    :global(.pane-box:not(:hover):has(> .pane-head:not(.active):not(:focus-within))) .facts .pos {
      width: 0;
      opacity: 0;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .facts .pos {
      transition: none;
    }
  }

  /* 좁은 타일의 양옆 단추 — 호버 · 키보드 포커스일 때만 */
  .side {
    position: absolute;
    top: 50%;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    padding: 0;
    color: var(--fg);
    background: var(--surface-raised);
    border: 1px solid var(--line);
    border-radius: 999px;
    opacity: 0;
    transform: translateY(-50%);
    transition: opacity 120ms ease;
    cursor: pointer;
  }

  .side.prev {
    left: 8px;
  }

  .side.next {
    right: 8px;
  }

  .stage:hover .side:not(:disabled),
  .side:focus-visible {
    opacity: 1;
  }

  .side:disabled {
    cursor: default;
  }

  /* 작은 지도 — 오른쪽 아래 · 축소 그림 + 지금 보는 사각형 */
  .map {
    position: absolute;
    right: 8px;
    bottom: 8px;
    overflow: hidden;
    background: var(--surface-raised-solid);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-sm);
    box-shadow: var(--shadow-raised);
    cursor: crosshair;
  }

  .map-pic {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: fill;
    pointer-events: none;
  }

  .map-rect {
    position: absolute;
    box-sizing: border-box;
    border: 1.5px solid var(--accent);
    background: color-mix(in srgb, var(--accent) 12%, transparent);
    pointer-events: none;
  }

  .map-close {
    position: absolute;
    top: 2px;
    right: 2px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    padding: 0;
    color: var(--fg);
    background: var(--surface-raised);
    border: none;
    border-radius: 999px;
    opacity: 0;
    cursor: pointer;
  }

  .map:hover .map-close,
  .map-close:focus-visible {
    opacity: 1;
  }
</style>
