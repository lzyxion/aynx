<script lang="ts">
  /**
   * **이미지 타일**(`kind:"image"` — 2026-11-14) — 그림 파일 한 장을 맞춤 · 1:1 · 확대로 보고, 같은 폴더의 그림을 이전/다음으로 훑는다.
   *
   * 문서 타일(`DocView`)처럼 **백엔드 하나**(`FsBackend` — 로컬 디스크 · 원본 터미널의 SFTP)만 받는다. 원격 세션 빌리기 · 같은 파일이면
   * 포커스만 · 배치 저장/복원 · 창 이관은 "파일 한 장 타일" 공용 함수(`isFileLeafKind` · `findFilePane` · `planFileOpen` · `borrowsSession`)가
   * 한다 — 이 화면은 그리기 · 읽기 · 보기만 쥔다.
   *
   * ## 읽기 (`image/read-plan.ts`)
   *
   * `stat` 으로 크기를 먼저 안다. 20 MB 이하는 미리 보기 패널과 같은 `readPreview` 한 번, 넘으면 `readImage`(Rust `*_read_image` — 조각 ·
   * 진행률 채널 · `op` 취소)로 받으며 막대 · `12.4 / 38.2 MB` · [취소] 를 그린다. 500 MB 이상은 읽기 전에 한 번 묻고, 1 GB 를 넘으면 읽지 않는다.
   * 받은 바이트는 **Blob URL** 로 `<img>` 에 그린다(자산 프로토콜 허용 범위를 넓히지 않는다 · SVG 도 `<img>` 로만 — 스크립트가 돌지 않는다).
   * 그림이 바뀌거나 타일이 사라지면 `revokeObjectURL` 하고, 늦게 온 옛 답은 번호(`seq`)로 버린다. 받는 중에 다른 그림으로 가면 앞 읽기를 취소한다.
   * **다른 경로**를 읽을 때(`image/picture-state`): direct 길(20 MB 이하)은 이전 그림을 둔 채 받아 화면 밖에서 풀고(`decode`) 그림 · 맞춤 ·
   * 배율 글자를 한 번에 바꾼다(깜빡이지 않는다 — 느린 원격이면 그동안 새 이름 밑에 옛 그림이 남는다). 진행 · 묻기 길과 실패 · 취소 · 파일 없음은
   * 그 순간 이전 그림(Blob URL · 원래 크기 · 보기)을 버린다 — 옛 그림이 비치지 않고 배율 글자는 그림 없음(`—`)이다. 같은 경로를 다시 읽을 때는
   * 그림을 남긴 채 바꿔 끼운다.
   *
   * ## 다시 읽기 · 끊김
   *
   * 문서 타일과 같은 박자(`doc-refresh.ts` — 로컬 1.5 s · 원격 4 s, 보일 때 · 닿을 때 · 그림이 있을 때만)로 `stat` 을 견주고, 크기 · 수정 시각이
   * 바뀌면 **조용히** 다시 읽는다(보기 · 배율은 그대로). 원격이 끊기면 마지막 그림을 흐리게 남기고 띠 한 줄 — 다시 붙으면(백엔드 키가 바뀌면)
   * 저절로 읽는다. 원본 터미널이 사라지면 파일 타일과 같은 "원본 없음" 띠.
   *
   * ## 보기 (`image/view-math.ts`)
   *
   * 열 때마다 **맞춤**(작은 그림은 1:1 — 늘리지 않는다 · 그래도 켜지는 것은 [맞춤] 하나 — `zoomPressed`)이고, 배율 · 이동 위치는 명세에 저장하지 않는다. 휠 = 커서 자리 기준 확대/축소 · 끌기 = 이동
   * (맞춤보다 클 때) · 더블클릭 = 맞춤 ⇄ 1:1. 타일 안 키(`image/keys.ts` — 수식키 조합은 흘려보낸다): ← → 이전/다음 · `0` 맞춤 · `1` 1:1 ·
   * `+`/`-` · `M` 작은 지도. 작은 지도는 맞춤보다 크게 볼 때만 오른쪽 아래에 서고 켬/끔은 앱 전체에 한 번 기억한다(`image/minimap-pref`).
   * 키는 몸(`.image`)과 도구줄 단추(Tab 으로 닿았을 때 — `onBarKey`)에서 듣고, 이 타일의 조작(도구줄 · 무대의 단추 · 작은 지도 × · 배율 목록
   * Escape · 고르기) 뒤에는 키보드를 몸으로 돌려놓는다(`backToBody` — 누른 단추에 남거나 `<body>` 로 떨어지지 않게).
   *
   * ## 머리줄 · 메뉴
   *
   * 도구줄은 머리줄에 맡긴다(`setPaneTools` — 머리줄이 없으면 몸 위에 그린다): [‹] `3 / 12` [›] · [맞춤 | 1:1] · 배율 `42% ▾`(`image/ZoomMenu` —
   * 포커스가 목록 밖으로 나가면 닫힌다 · 그림이 없으면 `—`) · 다시 읽기. 지금 그림이 "파일 없음"이 되면 `3 / 12` 는 비우고(사라진 그림을 세지
   * 않는다) 이전/다음은 남은 이웃으로 간다(`withoutCurrent`). 그 그림은 캐시된 폴더 목록에서도 빠져 다른 그림으로 옮겨도 다시 세지 않는다
   * (`withoutEntry` — 다음에 폴더를 다시 읽으면 그 목록이 대신한다). 머리줄 안에서 포커스 밖이면 이 도구줄은 통째로 접힌다(`data-head-act` — 이름만 남는다). 이름 뒤에 폴더를 두지 않는다(문서 타일과 같다 — 전체 경로는 이름 말풍선 · ⋯ [경로 복사]). 가운데 칸이 모자라면(이름 길이에 따라
   * 같은 타일 폭에서도 다르다 — 도구줄 상자의 폭을 펼친 머리줄 기준으로 잰다: 포커스 밖에서 `⋯ ⤢ ×` 가 접혀 넓어진 폭은 빼고 센다 · `expandedSlot`) 다시 읽기 → [맞춤 | 1:1] → 이전/다음 순서로 빠지고(`image/bar-fit`), 이전/다음이 빠지면
   * 좁은 타일과 같은 길(그림 위 양옆 단추 · 칩 앞 `3 / 12` · 칩은 아래 가운데 — `navOut`)로 간다. 좁은 타일은 배율만 남고 이전/다음은 그림 위 양옆 단추, `3 / 12 · 해상도` 칩은 아래 가운데로 간다(이전/다음이 도구줄에 있으면 칩은 왼쪽 아래). 칩 앞 `3 / 12` 는 머리줄 도구줄과 **같은 조건**으로 포커스 밖이면 접힌다(해상도 · 크기 · 형식은 늘 — 아래 `.facts .pos`). 본문 우클릭은 그림 메뉴
   * (`ImageMenu` — `imageMenuActions` 규칙 그대로, 앞에 맞춤 · 원래 크기, 뒤에 기본 앱 · 외부 편집기 · 폴더에서 보기)이고 메뉴 통로(`runOnMenu`)를 지난다.
   *
   * **하지 않는 것**: 편집 · 회전 · 저장(파일을 바꾸지 않는다) · 전용 폰 화면(원격 창은 같은 화면을 그린다).
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
  import { expandedSlot, fitBar } from "$lib/image/bar-fit";
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
    /** 보고 있는 그림의 절대 경로(`PaneSpec.path`) — 이전/다음은 [`onpath`] 로 올려 이 값이 바뀌어 내려온다 */
    path: string;
    backend: FsBackend;
    /** 원격이면 그 별칭(띠 문구) */
    alias?: string;
    /** 원본 터미널 타일이 아예 사라졌다(원격) */
    sourceGone?: boolean;
    onpath: (path: string) => void;
    onnotice?: (message: string) => void;
  } = $props();

  // ── 읽기 ────────────────────────────────────────────────────────────────────

  let phase = $state<ImagePhase>("loading");
  /** 그리는 그림 — Blob(메뉴의 복사 · 저장이 다시 읽지 않고 쓴다)과 그 URL. 둘은 늘 함께 바뀐다 */
  let url = $state<string | null>(null);
  let blob = $state.raw<Blob | null>(null);
  /** 지금 그린 그림의 경로 · 크기(바이트) — 칩 · 메뉴 */
  let drawnPath = $state("");
  let drawnSize = $state(0);
  /** 그림의 원래 크기 — `<img>` 가 다 읽은 뒤에 안다 */
  let natural = $state<Size | null>(null);
  let errorText = $state("");
  let progress = $state({ done: 0, total: 0 });
  /** 묻는 중 · 너무 큰 그림의 크기 */
  let pendingSize = $state(0);
  /** 받는 중인 조각 읽기의 번호(`transfer_cancel`) */
  let op: number | null = null;
  /** 늦게 온 답이 새 답을 덮지 않게 — 읽기마다 오른다 */
  let seq = 0;
  /** 마지막으로 읽은 때의 `stat` — 다시 읽기 박자가 견준다 */
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

  /** 같은 그림을 다시 읽었다 — 바이트만 바꿔 끼운다(원래 크기는 `<img>` 의 onload 가 다시 잰다 · 배율 · 이동은 그대로) */
  function replaceImage(b: Blob, size: number) {
    if (url) URL.revokeObjectURL(url);
    blob = b;
    url = URL.createObjectURL(b);
    drawnSize = size;
  }

  /**
   * 다른 그림을 받았다 — 화면 밖에서 먼저 풀어(`decode`) 원래 크기를 안 뒤 그림 · 크기 · 맞춤 · 배율 글자를 **한 번에** 바꾼다. 그 사이
   * 이전 그림(direct 길이면 남아 있다)이 그대로 서 있어 깜빡이지 않는다. 풀지 못하면 "그리지 못함"(이전 그림은 버린다).
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
    // 다른 그림 — 열 때마다 맞춤(배율 · 위치는 저장하지 않는다)
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

  /**
   * 그림 하나를 읽는다 — `stat` → 계획(`imageReadPlan`) → 바이트 → Blob URL. `silent` 면(다시 읽기 박자 · 재연결) 그리던 그림과 상태를
   * 그대로 둔 채 읽고, 다 받으면 바꾼다.
   */
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
    // 다른 그림을 읽을 때 그리던 그림을 언제 버리나 — `image/picture-state`: direct 길은 새 그림이 그려질 때 한 번에 바꾸고(깜빡이지
    // 않게), 진행 · 묻기 길과 실패 · 취소 · 파일 없음은 그 순간 버린다(새 이름 밑에 옛 그림 · 옛 배율이 남지 않게)
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
      // 끊김은 띠가 말한다 — 같은 그림이면 그리던 그림은 남긴다
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

  /** [다시 읽기] — 사람이 누른 것은 조용하지 않다(폴더 목록도 다시) */
  function reload() {
    if (offline || path === "") return;
    listing = null;
    void load(path, {});
    void syncSiblings(true);
  }

  /** [그래도 열기] */
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

  // 경로 · 원본(재연결 — 키가 바뀐다)이 바뀌면 읽는다. 같은 그림의 재연결이면 조용히
  $effect(() => {
    const p = path;
    void backend.key;
    if (!backend.online || p === "") return;
    untrack(() => void load(p, { silent: p === drawnPath && url !== null }));
  });

  // 다시 읽기 박자 — 문서 타일과 같은 판정(`shouldPoll`)
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

  /** 마지막으로 읽은 폴더 목록 — 같은 폴더 안에서 옮겨 다닐 때는 다시 읽지 않는다(없어진 그림은 `forgetGone` 이 뺀 채로) */
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
   * 지금 그림이 "파일 없음"이 됐다 — 캐시된 폴더 목록에서도 **영구히** 뺀다(`withoutEntry`). 빼지 않으면 다른 그림으로 옮기는 순간 `8 / 10` 처럼
   * 지운 그림을 다시 세고 ← 로 그 빈 파일에 되돌아간다. 다음에 폴더를 다시 읽으면([다시 읽기] · 다른 폴더) 진짜 목록이 대신한다 —
   * 옮길 때마다 목록을 다시 읽지 않는다(원격에서 `list` 왕복을 이동마다 더하지 않게).
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

  /** 이전/다음이 쓰는 목록 — 지금 그림이 없어졌으면(파일 없음) 그것을 뺀 목록과 그 빈자리(캐시에서도 이미 빠졌다 — `forgetGone`) */
  const navList = $derived(phase === "missing" ? withoutCurrent(siblings, path) : siblings);
  const counter = $derived(siblingCounter(navList));
  const prevPath = $derived(neighborPath(navList, -1));
  const nextPath = $derived(neighborPath(navList, 1));
  /** 이전/다음 무리를 세우는가 — `3 / 12` 가 있거나(둘 이상) 지금 그림이 없어졌어도 남은 이웃이 있으면 */
  const hasNav = $derived(counter !== null || prevPath !== null || nextPath !== null);

  function go(dir: 1 | -1) {
    const to = dir < 0 ? prevPath : nextPath;
    if (to) onpath(to);
  }

  // ── 보기 ────────────────────────────────────────────────────────────────────

  let rootEl = $state<HTMLDivElement | null>(null);
  let stageEl = $state<HTMLDivElement | null>(null);
  /** 무대(그림 상자) 크기 · 타일 폭 */
  let box = $state<Size>({ w: 0, h: 0 });
  let tileW = $state(0);
  /** 맞춤 보기인가 — 참이면 무대가 바뀔 때마다 다시 맞춘다 */
  let fit = $state(true);
  /** 맞춤이 아닐 때의 보기 */
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

  /** 지금 보기 — 맞춤이면 그때그때 셈한 것 */
  const view = $derived<View>(natural ? (fit ? fitView(natural, box) : free) : { scale: 1, x: 0, y: 0 });
  const fitS = $derived(natural ? fitScale(natural, box) : 1);
  /** 좁은 타일 — 머리줄엔 배율만, 이전/다음은 그림 위 양옆, 칩은 아래 가운데 */
  const narrow = $derived(tileW > 0 && tileW < 440);
  const pannable = $derived(natural !== null && !fit && canPan(view, natural, box));
  const mapShown = $derived(minimapOn() && natural !== null && !fit && aboveFit(view.scale, natural, box));

  // 맞춤이 아닐 때 무대가 바뀌면 경계로 다시 묶는다
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

  /** 끌어서 이동 — 맞춤보다 클 때만 */
  let drag: { id: number; x: number; y: number } | null = $state(null);
  function onPointerDown(ev: PointerEvent) {
    // 그림을 누르면 타일의 키보드 몸이 키를 받는다(← → · 0 · 1 · + · - · M)
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

  /** 더블클릭 — 맞춤 ⇄ 1:1(커서 자리 기준) */
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
   * 이 타일의 조작(도구줄 단추 · 무대의 단추 · 작은 지도 × · 배율 목록 Escape · 백드롭) 뒤 — 키보드를 타일의 몸(`.image`)으로 돌려놓는다.
   * 그러지 않으면 누른 단추에 포커스가 남거나(키는 몸에서만 듣는다) 누른 단추가 사라지고 흐려져 포커스가 `<body>` 로 떨어져 ← → · `0` · `1` ·
   * `+` · `-` · `M` 이 먹지 않는다. 문서 타일의 [고정]과 같은 길(`rootEl.focus`).
   */
  function backToBody() {
    rootEl?.focus({ preventScroll: true });
  }

  /** 단추 하나의 일 + 몸으로 돌려놓기 */
  const act = (fn: () => void) => () => {
    fn();
    backToBody();
  };

  /**
   * 도구줄 단추에 포커스가 있을 때(Tab 으로 닿았다)도 같은 키를 받는다 — 머리줄 도구줄은 몸 밖(`.pane-tools`)이라 몸의 `onkeydown` 에 닿지 않는다.
   * 판정은 몸과 같은 `imageKeyAction`(수식키 조합 · Tab · Space · Enter 는 흘려보낸다 — 단추 자신의 키는 그대로 · 단추는 ← → 를 스스로 쓰지
   * 않는다). 받은 뒤에는 몸으로 돌려놓는다(이전/다음이 끝에서 흐려지면 포커스가 떨어지지 않게).
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
  /** 배율 글자 — 그림이 없으면(묻기 · 파일 없음 · 그리지 못함 · 받는 중 · 취소됨) `—` */
  const pct = $derived(zoomLabel(natural ? view.scale : null));
  /** [맞춤 | 1:1] 의 켬 — 하나만(작은 그림의 맞춤 = 1:1 이어도 [맞춤] 만) */
  const pressed = $derived(zoomPressed(natural !== null, fit, view.scale));
  const inHead = $derived(paneHeadShown(paneId));
  /**
   * 도구줄 상자의 폭 — 머리줄이면 가운데 칸의 폭(이름 길이에 따라 같은 타일에서도 다르다) · 그 안에 든 것(`image/bar-fit`). **펼친 머리줄의 폭**으로
   * 센다(`expandedSlot` — 포커스 밖에서 `⋯ ⤢ ×` 가 접혀 넓어진 폭 · 접힘 움직임 중의 폭을 그대로 쓰면 판정이 바뀌어 이전/다음이 튄다)
   */
  let barW = $state(0);

  function measureBar(node: HTMLElement) {
    const head = node.closest<HTMLElement>(".pane-head");
    const read = () => {
      const heads = head
        ? Array.from(head.querySelectorAll<HTMLElement>(":scope > .head-btn"), (b) => ({
            width: b.getBoundingClientRect().width,
            marginLeft: parseFloat(getComputedStyle(b).marginLeft) || 0,
          }))
        : [];
      barW = expandedSlot(node.getBoundingClientRect().width, heads);
    };
    const ro = new ResizeObserver(read);
    ro.observe(node);
    read();
    return { destroy: () => ro.disconnect() };
  }
  const counterText = $derived(counter ? `${counter.at} / ${counter.total}` : null);
  /** 안쪽 여백을 뺀 폭 — 머리줄 안 `.bar.inhead` 는 왼쪽 4, 몸 위 `.bar` 는 양옆 6. 이전/다음만 남은 때(지금 그림이 없어졌다)는 가운데 글자 없이 센다 */
  const fits = $derived(fitBar(barW > 0 ? barW - (inHead ? 4 : 12) : 0, hasNav ? (counterText ?? "") : null, pct));
  /** 이전/다음 · `3 / 12` 가 도구줄 밖(그림 위 양옆 · 아래 칩)에 서는가 — 좁은 타일이거나 도구줄에 안 들어갈 때 */
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

<!-- 외부 열기 단추 하나(띠 · 빈 화면) — 로컬은 기본 앱, 원격은 외부 편집기 -->
{#snippet externalButton()}
  {#if backend.canOpenExternal}
    <button type="button" class="retry" onclick={() => void openExternally()}>{t("files.menu.openexternal")}</button>
  {:else if backend.canEdit}
    <button type="button" class="retry" disabled={offline} onclick={() => void editRemote()}>{t("files.menu.edit.external")}</button>
  {/if}
{/snippet}

<!-- 도구줄 — 머리줄이 서 있으면 머리줄 가운데에, 아니면 몸 맨 위에(`pane/pane-tools.svelte.ts`). 도구줄 전체가 `data-head-act`(포커스 밖이면 접힌다 —
     이전/다음은 `3 / 12` 까지 무리째, 배율 단추는 목록이 열린 동안 `aria-expanded` 로 남는다 · 몸 위에 그릴 때는 접지 않는다). 칸이 모자라면 다시 읽기 → [맞춤 | 1:1] → 이전/다음 순서로 뺀다(`image/bar-fit` — 배율은 늘 남는다) -->
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
        <!-- 지금 그림이 없어졌으면 빈 칸(사라진 그림을 세지 않는다 — 자리 폭은 그대로) -->
        <span class="count" data-image-counter>{counterText ?? ""}</span>
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
      onclick={openZoomMenu}>{pct}<UiIcon name="chevron-down" size={12} /></button
    >
    {#if !narrow && fits.reload}
      <button
        type="button"
        class="btn ico"
        data-head-act
        disabled={offline || phase === "loading" || phase === "progress"}
        title={t("files.image.reload")}
        aria-label={t("files.image.reload")}
        onclick={act(reload)}><UiIcon name="refresh" size={13} /></button
      >
    {/if}
  </div>
{/snippet}

<!--
  `tabindex="-1" data-tile-focus` — 이 상자가 **타일의 키보드 몸**이다(`routeTileFocus` 가 여기 포커스를 준다). 키는 여기서 듣는다.
-->
<div
  class="image"
  role="presentation"
  tabindex="-1"
  data-tile-focus
  bind:this={rootEl}
  {onkeydown}
>
  {#if !inHead}{@render imageBar(false)}{/if}

  <!-- 띠 둘은 뜻이 다르다 — 기다리면 돌아온다(끊김) · 돌아오지 않는다(원본 없음). 파일 브라우저 · 문서 타일과 같은 자리 -->
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
      <!-- 좁은 타일(또는 도구줄에 안 들어갈 때)의 이전/다음 — 그림 위 양옆 둥근 단추(호버 · 포커스일 때만 보인다 · 파일 없음에도 남은 이웃으로) -->
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
      <!-- 칩 — 이전/다음이 도구줄에 있으면 왼쪽 아래(해상도 · 크기 · 형식), 그림 위로 나갔으면(`navOut` — 좁은 타일이든 이름이 길어 빠졌든) 아래 가운데(`3 / 12` 를 앞에) -->
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
  }

  /* ── 도구줄 — 문서 타일(`doc/DocToolbar`)과 같은 결 ── */
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

  .btn.pct {
    padding: 0 4px 0 6px;
    font-variant-numeric: tabular-nums;
  }

  .seg .btn {
    border-radius: 999px;
  }

  .btn.on {
    color: var(--fg);
    background: var(--accent-soft);
  }

  /* ── 띠 — 문서 타일과 같은 말(기다림 = 앰버 · 돌아오지 않음 = 빨강) ── */
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
   * 칩 앞 `3 / 12` — 머리줄 도구줄(`data-head-act`)과 **같은 조건**으로 포커스 밖이면 접는다: 타일 상자(`.pane-box`)에 호버가 없고 그 상자의
   * 머리줄(직계 `.pane-head`)이 `active`(포커스 · 하나뿐인 타일)도 `:focus-within` 도 아닐 때 — 셀렉터는 `pane/PaneHeader.svelte` 의 "드러냄"
   * 규칙 그대로다. 머리줄이 없는 타일(몸 위 도구줄 — 늘 보임)은 `.pane-head` 가 없어 걸리지 않으니 `3 / 12` 도 늘 보인다. 글은 DOM 에 남는다
   * (폭 0 + 불투명도 — 읽는 문구는 그대로), 빠르기는 머리줄 접기와 같은 120ms.
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
