<script lang="ts">
  /**
   * 문서 보기 타일 (docs/log/2026-09-27-doc-tile.md). 어디의 파일인지는 `backend` 만 안다 — 여기에는 `local_*` · `sftp_*` · 세션 id 가 없다.
   *
   * - 원본이 끊기거나 사라져도 마지막으로 읽은 글은 그대로 둔다. `[session-gone]` 은 빨간 오류로 적지 않는다 — 배너가 같은 사실을 말한다.
   * - HTML 을 만들지 않는다 — 문서 글이 `{@html}` 로 들어가는 곳은 없다. 예외는 mermaid `securityLevel: "strict"` 의 SVG 와 KaTeX `trust: false` 의 HTML 둘뿐.
   * - 그림은 문서와 같은 백엔드의 경로만 `blob:` `<img>` 로 그린다 — 스킴 있는 주소(`http` · `data:` · `file:` …)는 불러오지 않는다(문서를 여는 것만으로 바깥에 요청이 나가지 않게).
   * - `F5` · `Ctrl+R` 은 개발용으로 살려 둔 브라우저 키라 가로채지 않는다.
   * - 저장은 사람이 누른 저장(`Ctrl+S` · [저장])뿐이고 편집 시작 때의 `version` 을 기대값으로 보낸다. 편집 중 자동 새로고침은 글을 바꾸지 않고 띠만 세운다.
   * - 편집기는 보기를 바꿔도 내리지 않고 숨기기만 한다 — 되돌리기 기록 · 커서가 산다.
   * - 읽기 보기 · 편집 중 미리 보기 · 줄↔절이 같은 `DOC_TILE_MD` 선택을 써야 제목 짝이 맞는다.
   *
   * 곁 패널 — 켬 · 편집 보기 · 글자 배율은 타일의 것이고 미리 보기를 고정하지 않는다. 단추 자리는 고정이다(파일 토글은 이름 뒤 `tail`,
   * 목차 토글은 도구줄 맨 끝) — 여닫아도 · 넓음 ↔ 좁음에도 x 가 움직이지 않는다.
   */
  import { onDestroy, tick, untrack } from "svelte";
  import { openUrl } from "@tauri-apps/plugin-opener";
  import CodeView from "$lib/CodeView.svelte";
  import MarkdownBlocks from "$lib/MarkdownBlocks.svelte";
  import type DocEditor from "$lib/DocEditor.svelte";
  import DocOutline from "$lib/DocOutline.svelte";
  import DocToolbar from "$lib/doc/DocToolbar.svelte";
  import DocEditPane from "$lib/doc/DocEditPane.svelte";
  import UiIcon from "$lib/UiIcon.svelte";
  import { LOCAL_KEY, TEXT_VIEW_MAX_BYTES, type FsBackend } from "$lib/fs-backend";
  import { DOC_TILE_MD, blockStartLines, parseMarkdown } from "$lib/markdown";
  import { LINE_FLASH_MS, blockAtLine, jumpLineIndex } from "$lib/doc-line-jump";
  import { tooLargeToHighlight } from "$lib/highlight-size";
  import { autoRefreshOn, readAgo, pollIntervalOf } from "$lib/doc-refresh";
  import { isMarkdown, langOf } from "$lib/doc-lang";
  import { classifyDocHref, matchAnchor } from "$lib/doc-links";
  import { taskCharOf, taskMarkOf } from "$lib/doc-task";
  import { imageSrcsOf } from "$lib/doc-images";
  import { DocImageCache } from "$lib/doc-images.svelte";
  import { createDocOutline } from "$lib/doc/outline-controller.svelte.js";
  import { createDocFiles } from "$lib/doc/files-controller.svelte.js";
  import type { DocFilesSeed } from "$lib/doc-files";
  import { DOC_SWAP_FADE_MS, takeDocSwap } from "$lib/doc-swap";
  import DocFiles from "$lib/doc/DocFiles.svelte";
  import { createToggleMotion, sidePanelGrow } from "$lib/browser/tree-accordion";
  import {
    DOC_FILES_PANEL_W,
    DOC_OUTLINE_PANEL_W,
    docPanelLayout,
    panelToCloseOnOpen,
    type DocSidePanel,
  } from "$lib/doc-side-panels";
  import { createDocDocument } from "$lib/doc/document-controller.svelte.js";
  import {
    DOC_SPLIT_DEFAULT,
    clampDocSplit,
    isWideEdit,
    narrowTabOf,
    sectionAt,
    sectionLines,
    splitAt,
    syncTarget,
    visibleEditView,
    type EditorViewport,
    type NarrowEditTab,
  } from "$lib/doc-edit-preview";
  import { DOC_ZOOM_DEFAULT, wheelDocZoom } from "$lib/doc-zoom";
  import { provideDocZoom } from "$lib/doc-zoom-context";
  import { editBlockOf } from "$lib/doc-edit";
  import { compareTexts, type CompareResult } from "$lib/doc-compare";
  import DocCompareView from "$lib/doc/DocCompareView.svelte";
  import { stripReason } from "$lib/error-reason";
  import { registerDocSaver, setDocDirty } from "$lib/app/doc-dirty.svelte";
  import {
    dropDocDraft,
    hasPendingDocDraft,
    pendingDocDraft,
    registerDocDraft,
    type DraftCapture,
  } from "$lib/app/doc-drafts.svelte.js";
  import { fitDocDraft, type DocDraft, type DraftSelection } from "$lib/doc-draft";
  import { writeClipboard } from "$lib/clipboard";
  import { askConfirm } from "$lib/app/confirm-dialog.svelte.js";
  import { registerTileFind } from "$lib/app/tile-find";
  import DomFindBar from "$lib/DomFindBar.svelte";
  import { DirtyBinding } from "$lib/doc-dirty-table";
  import { runOnMenu } from "$lib/browser/menu-runner";
  import { DOC_TOOL_EDIT_EXTERNAL, DOC_TOOL_EXTERNAL, docExternalItems, docMenuItems } from "$lib/doc-menu";
  import { runEditMenu, runReadMenu, selectionIn, type ReadMenuActions } from "$lib/doc/context-actions";
  import type { PaneMenuRow } from "$lib/pane/pane-menu";
  import { formatSize } from "$lib/sftp-browser";
  import type { DocEditView, DocMode } from "$lib/session";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { paneHeadShown, setPaneTools } from "$lib/pane/pane-tools.svelte.js";
  import { codeToTerminal } from "$lib/app/code-to-term.svelte.js";
  import { newDocState } from "$lib/app/new-doc.svelte.js";

  let {
    paneId,
    path,
    backend,
    mode = "rendered",
    onmode,
    outline = false,
    onoutline,
    files = false,
    onfiles,
    onswitch,
    editView = "split",
    oneditview,
    split,
    onsplit,
    zoom = DOC_ZOOM_DEFAULT,
    onzoom,
    preview = false,
    onkeep,
    onunkeep,
    alias = "",
    sourceGone = false,
    onnotice,
    onopenlink,
    anchor,
    onanchordone,
    line,
    onlinedone,
    editOnce = false,
    oneditoncedone,
    onmenu,
  }: {
    paneId?: string;
    path: string;
    backend: FsBackend;
    mode?: DocMode;
    onmode?: (mode: DocMode) => void;
    outline?: boolean;
    onoutline?: (open: boolean) => void;
    files?: boolean;
    onfiles?: (open: boolean) => void;
    onswitch?: (path: string, files: DocFilesSeed) => void;
    editView?: DocEditView;
    oneditview?: (view: DocEditView) => void;
    split?: number;
    onsplit?: (ratio: number) => void;
    zoom?: number;
    onzoom?: (zoom: number) => void;
    preview?: boolean;
    onkeep?: () => void;
    onunkeep?: () => void;
    alias?: string;
    /** 원본 터미널 타일이 아예 없어졌다(닫혔거나 이관에서 빠졌다) — 원격만 */
    sourceGone?: boolean;
    onnotice?: (message: string) => void;
    /** 적힌 경로(퍼센트 인코딩을 푼 것)와 `#절` — 상위가 이 문서 기준으로 푼다 */
    onopenlink?: (link: string, anchor?: string) => void;
    /** 저장되지 않는 한때 값(`app/doc-anchors`) */
    anchor?: string;
    onanchordone?: () => void;
    /** 1 기준 줄(터미널의 `파일:12`) — 저장되지 않는 한때 값(`app/doc-anchors`) */
    line?: number;
    onlinedone?: () => void;
    /** 저장되지 않는 한때 값(`app/doc-anchors`) */
    editOnce?: boolean;
    oneditoncedone?: () => void;
    onmenu?: (x: number, y: number, menu: { rows: PaneMenuRow[]; run: (key: string) => void }) => void;
  } = $props();

  let bodyEl = $state<HTMLDivElement | null>(null);
  let rootEl = $state<HTMLDivElement | null>(null);

  // ── 갈아 끼워진 문서 ──
  // 떠오르기는 본문 상자(`.body`)에만 건다 — 타일 상자나 그 조상에 `opacity` 를 걸면 글래스 흐림 판이 빠진다(`PaneHost` 의 `.glass-tile` 절).
  // 첫 id 로 한 번만 꺼낸다(뒤에 바뀐 id 는 갈아 끼워진 문서가 아니다) — 그래서 `untrack`
  const swapped = untrack(() => (paneId ? takeDocSwap(paneId) : null));
  let fadePending = swapped !== null;
  $effect(() => {
    const el = bodyEl;
    if (!fadePending || !el || dc.file === null) return;
    fadePending = false;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: DOC_SWAP_FADE_MS, easing: "ease-out" });
  });

  // ── 문서 ──
  const dc = createDocDocument({
    get path() {
      return path;
    },
    get backend() {
      return backend;
    },
    get offline() {
      return offline;
    },
    get sourceGone() {
      return sourceGone;
    },
    get preview() {
      return preview;
    },
    get editor() {
      return editor;
    },
    get rootEl() {
      return rootEl;
    },
    scroller,
    onkeep: () => onkeep?.(),
    onunkeep: () => onunkeep?.(),
    onnotice: (message) => onnotice?.(message),
    onEditStart: previewOnEditStart,
    onEditReload: previewOnEditReload,
    stopPreviewTimer,
  });

  const offline = $derived(!backend.online);
  const markdown = $derived(isMarkdown(path));
  const rendered = $derived(markdown && mode !== "source" && !dc.editing);
  const lang = $derived(markdown ? "markdown" : langOf(path));
  const text = $derived(dc.file && !dc.file.binary ? dc.file.text : "");
  const blocks = $derived(rendered && text !== "" ? parseMarkdown(text, DOC_TILE_MD) : []);
  const plain = $derived(!rendered && lang !== null && text !== "" && tooLargeToHighlight(text));

  /** 숫자로 떼어 둔다 — 상위가 백엔드 객체를 새로 내려 줄 때마다 타이머가 다시 서면 영영 울리지 않는다 */
  const pollMs = $derived(pollIntervalOf(backend.key));
  const autoOn = $derived(
    autoRefreshOn({ online: backend.online, sourceGone, hasFile: dc.file !== null, error: dc.error !== null }),
  );

  // ── 편집 ──

  let editor = $state<ReturnType<typeof DocEditor> | null>(null);

  const showEdit = $derived(backend.canWrite === true && dc.file !== null && !dc.file.binary);

  function editTitle(): string {
    if (dc.editBlock === "truncated") return t("files.doc.edit.block.truncated");
    if (dc.editBlock === "lossy") return t("files.doc.edit.block.lossy");
    if (offline) return t("files.doc.edit.block.offline");
    return t("files.doc.edit");
  }

  // 저장 안 한 변경 표 — 걸어 둔 초안(`app/doc-drafts`)도 저장 안 한 변경이다.
  // 효과에 정리 함수를 두지 않는다 — 상위가 같은 타일을 다시 내려 줄 때 지운 뒤 다시 적지 않아 ● 가 꺼지고 닫기가 묻지 않았다(docs/log/2026-09-27-doc-edit.md).
  // 쓰기는 `untrack` — 표를 읽어 구독하면 제가 쓴 값에 다시 깨어난다(`effect_update_depth_exceeded`).
  const dirtyBinding = new DirtyBinding(setDocDirty);
  $effect(() => {
    const id = paneId;
    const value = (dc.editing && dc.dirty) || (!!id && hasPendingDocDraft(id));
    untrack(() => dirtyBinding.sync(id, value));
  });

  // `paneId` 만 구독한다 — `save` 는 부를 때 상태를 읽는다
  $effect(() => {
    const id = paneId;
    if (!id) return;
    return untrack(() =>
      registerDocSaver(id, () => {
        // 걸어 둔 초안이 아직 편집기에 들지 않았다 — 저장할 글이 편집기에 없으니 "저장했다" 고 하면 닫기가 글을 버린다
        if (hasPendingDocDraft(id)) {
          onnotice?.(t("files.doc.draft.saveBlocked"));
          return Promise.resolve(false);
        }
        return dc.save();
      }),
    );
  });

  // ── 창을 넘는 초안 ──
  // 받는 쪽은 편집기가 실제로 섰을 때만 초안을 내린다 — 그 전에 막히면 초안을 쥔 채 띠로 말하고, 그동안도 저장 안 한 변경이다(닫기 가드 · ●).

  function captureDraft(): DraftCapture | null {
    const ed = editor;
    if (!dc.editing || !dc.dirty || !ed) return null;
    const snap = ed.draft();
    const ref = ed.docRef();
    if (!snap || !ref) return null;
    const draft = fitDocDraft({
      text: snap.text,
      baseVersion: dc.baseVersion,
      eol: snap.eol,
      selection: snap.selection as DraftSelection | undefined,
      scrollPos: snap.scrollPos,
      history: snap.history,
    });
    if (!draft) return null;
    return {
      draft,
      still: () => editor === ed && dc.editing && ed.docRef() === ref,
      freeze: (on) => ed.setFrozen(on),
    };
  }

  $effect(() => {
    const id = paneId;
    if (!id) return;
    return untrack(() => registerDocDraft(id, captureDraft));
  });

  const heldDraft = $derived(paneId ? pendingDocDraft(paneId) : undefined);
  let draftStalled = $state(false);
  let applyingDraft: DocDraft | null = null;

  const draftBlock = $derived.by<"wait" | "read" | "noedit" | "readonly" | "offline" | "editor" | null>(() => {
    if (!heldDraft || dc.editing) return null;
    if (draftStalled) return "editor";
    if (dc.file === null) return dc.error !== null ? "read" : "wait";
    if (dc.editBlock !== null) return "noedit";
    if (!backend.canWrite) return "readonly";
    if (offline) return "offline";
    return null;
  });

  $effect(() => {
    const d = heldDraft;
    if (!d || dc.editing || draftBlock !== null) return;
    untrack(() => {
      if (dc.startEditFromDraft(d)) applyingDraft = d;
    });
  });

  function editorReady() {
    const d = applyingDraft;
    applyingDraft = null;
    if (d && paneId) dropDocDraft(paneId, d);
  }

  function onEditorFailed(message: string) {
    if (applyingDraft) {
      applyingDraft = null;
      draftStalled = true;
    }
    dc.editorFailed(message);
  }

  function retryDraft() {
    draftStalled = false;
    if (dc.file === null || dc.error !== null) void dc.load();
  }

  async function copyDraft() {
    const d = heldDraft;
    if (!d) return;
    if (!(await writeClipboard(d.text))) onnotice?.(t("files.doc.menu.copy.fail"));
  }

  async function discardDraft() {
    const d = heldDraft;
    if (!d || !paneId) return;
    const ok = await askConfirm(t("files.doc.draft.discard.confirm"), { kind: "warning", danger: true });
    if (ok && paneId) dropDocDraft(paneId, d);
  }

  onDestroy(() => {
    dirtyBinding.dispose();
    dc.dispose();
    stopPreviewTimer();
  });

  // ── 체크박스 ─────────────────────────────────────────────────────────────────

  const readTasks = $derived({
    title: t("files.doc.task.toggle"),
    blocked: dc.taskBlocked,
    busy: dc.taskBusy,
    ontoggle: dc.toggleTask,
  });
  const editTasks = $derived({
    title: t("files.doc.task.toggle.edit"),
    blocked: null,
    busy: new Set<number>(),
    ontoggle: togglePreviewTask,
  });

  /** 편집 중 미리 보기의 체크박스 — 미리 보기가 아직 옛 글이면 다시 그리기만 한다(줄이 어긋난 채 고치지 않는다) */
  function togglePreviewTask(line: number, wasChecked: boolean) {
    if (!dc.editing || !editor) return;
    if (editor.getText() !== previewText) {
      flushPreview();
      return;
    }
    const lt = editor.lineText(line);
    const mark = lt === null ? null : taskMarkOf(lt);
    if (!mark || mark.checked !== wasChecked) return;
    if (editor.replaceInLine(line, mark.col, mark.col + 1, taskCharOf(!wasChecked))) flushPreview();
  }

  $effect(() => {
    const ms = pollMs;
    const id = setInterval(() => void dc.poll(), ms);
    return () => clearInterval(id);
  });

  /** 경로 · 원본(`backend.key` — 재연결이면 바뀐다)이 바뀌면 다시 읽는다 */
  $effect(() => {
    const p = path;
    void backend.key;
    if (!backend.online || p === "") return;
    untrack(() => void dc.load());
  });

  /** 툴팁을 띄울 때 잰 지금 — 시계를 돌리지 않는다 */
  let infoNow = $state(Date.now());

  const autoInfo = $derived.by(() => {
    if (!autoOn) return t("files.doc.autoinfo.off");
    if (!dc.updatedAt) return undefined;
    const ago = readAgo(infoNow - dc.updatedAt.getTime());
    return t(`files.doc.autoinfo.${ago.unit}`, { n: String(ago.n) });
  });

  /** 단추가 누르자마자 사라지므로 포커스를 타일의 키보드 몸으로 되돌린다 */
  function keep() {
    onkeep?.();
    rootEl?.focus({ preventScroll: true });
  }

  function unkeep() {
    onunkeep?.();
    rootEl?.focus({ preventScroll: true });
  }

  /** `MarkdownBlocks` 가 이미 `http`/`https` 만 넘긴다 */
  function openLink(href: string) {
    void openUrl(href).catch((e: unknown) => {
      console.error(`[aynx] 링크를 열지 못했습니다: ${href}`, e);
    });
  }

  function openDocLink(href: string) {
    const c = classifyDocHref(href);
    if (c.kind === "anchor") scrollToAnchor(c.anchor);
    else if (c.kind === "path") onopenlink?.(c.path, c.anchor);
  }

  const codeActions = $derived.by(() => {
    const id = paneId;
    if (!id) return undefined;
    return {
      onterm: (code: string, button: HTMLElement) => {
        const r = button.getBoundingClientRect();
        codeToTerminal(id, code, { x: r.right, y: r.bottom + 4, align: "right" }, button);
      },
    };
  });

  /** 본문 상자만 민다 — `scrollIntoView` 는 조상의 넘침 숨김 상자까지 밀어 타일 배치를 흔든다 */
  function scrollToAnchor(a: string): boolean {
    if (!bodyEl || !rendered) return false;
    return scrollBoxToAnchor(bodyEl, a);
  }

  function scrollBoxToAnchor(box: HTMLElement, a: string): boolean {
    const heads = [...box.querySelectorAll<HTMLElement>("[data-slug]")];
    const hit = matchAnchor(
      a,
      heads.map((h) => h.dataset.slug ?? ""),
    );
    const el = hit === null ? undefined : heads.find((h) => h.dataset.slug === hit);
    if (!el) return false;
    scrollBoxToEl(box, el);
    return true;
  }

  function scrollBoxToEl(box: HTMLElement, el: HTMLElement) {
    const top = el.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop;
    box.scrollTo({ top: Math.max(0, top - 8) });
  }

  $effect(() => {
    const a = anchor;
    if (!a) return;
    if (dc.file === null) {
      if (dc.error !== null) untrack(() => onanchordone?.());
      return;
    }
    void blocks;
    untrack(() => {
      void tick().then(() => {
        scrollToAnchor(a);
        onanchordone?.();
      });
    });
  });

  // ── 편집으로 한 번 ([새 문서…]) ──
  $effect(() => {
    if (!editOnce) return;
    if (dc.file === null) {
      if (dc.error !== null) untrack(() => oneditoncedone?.());
      return;
    }
    untrack(() => {
      if (!dc.editing) dc.startEdit();
      oneditoncedone?.();
    });
  });

  // ── 이 줄로 (터미널의 `파일:12`) ──

  /** 0 기준 */
  let codeFlash = $state<number | null>(null);
  let flashEl: HTMLElement | null = null;
  let flashTimer: ReturnType<typeof setTimeout> | undefined;

  function stopLineFlash() {
    clearTimeout(flashTimer);
    flashTimer = undefined;
    codeFlash = null;
    flashEl?.classList.remove("line-flash");
    flashEl = null;
  }

  onDestroy(stopLineFlash);

  $effect(() => {
    const n = line;
    if (n === undefined) return;
    if (dc.editing) {
      untrack(() => onlinedone?.());
      return;
    }
    if (dc.file === null) {
      if (dc.error !== null) untrack(() => onlinedone?.());
      return;
    }
    void blocks;
    void text;
    untrack(() => {
      void tick().then(async () => {
        await jumpToLine(n);
        onlinedone?.();
      });
    });
  });

  async function jumpToLine(n: number) {
    const file = dc.file;
    if (!bodyEl || !file || file.binary || dc.editing) return;
    const idx = jumpLineIndex(n, text, file.truncated);
    if (idx === null) return;
    stopLineFlash();
    if (rendered) {
      const el = renderedBlockAt(idx);
      if (!el) return;
      scrollBoxToEl(bodyEl, el);
      el.classList.add("line-flash");
      flashEl = el;
    } else {
      // 판을 다시 세운다 — 같은 줄이어도 애니메이션이 처음부터
      await tick();
      codeFlash = idx;
      await tick();
      const box = scroller();
      const band = box?.querySelector<HTMLElement>("[data-line-flash]");
      if (!box || !band) return;
      box.scrollTo({ top: Math.max(0, band.offsetTop - box.clientHeight / 3) });
    }
    flashTimer = setTimeout(stopLineFlash, LINE_FLASH_MS);
  }

  /** 최상위 블록 수가 맞을 때만 번호로 고르고, 어긋나면 그 줄이 든 절의 제목으로 물러선다 */
  function renderedBlockAt(idx: number): HTMLElement | null {
    const root = pageEl?.querySelector<HTMLElement>(":scope > [data-markdown]");
    if (!root) return null;
    if (root.children.length === blocks.length) {
      const bi = blockAtLine(blockStartLines(text, DOC_TILE_MD), idx);
      const el = bi === null ? null : root.children[bi];
      return el instanceof HTMLElement ? el : null;
    }
    const slug = sectionAt(sectionLines(text, blocks, DOC_TILE_MD), idx);
    return slug === null ? null : root.querySelector<HTMLElement>(`[data-slug="${CSS.escape(slug)}"]`);
  }

  function scroller(): HTMLElement | null {
    if (!bodyEl) return null;
    if (rendered) return bodyEl;
    return bodyEl.querySelector<HTMLElement>("[data-code-view]") ?? bodyEl;
  }

  // ── 곁 패널 — 목차(오른쪽) ──

  let tileWidth = $state(0);
  const oc = createDocOutline({
    get rendered() {
      return rendered;
    },
    get blocks() {
      return blocks;
    },
    get file() {
      return dc.file;
    },
    get text() {
      return text;
    },
    get narrow() {
      return layout.narrow;
    },
    get outlineShown() {
      return layout.outlineShown;
    },
    get bodyEl() {
      return bodyEl;
    },
    get rootEl() {
      return rootEl;
    },
    scrollToAnchor,
  });

  // ── 곁 패널 — 파일(왼쪽) · 폭 규칙 · 토글 ──

  /** 나중에 연 쪽 — 한때 값 · 저장하지 않는다 */
  let lastPanel = $state<DocSidePanel | null>(null);
  const filesSlot = $derived(path !== "");
  const layout = $derived(
    docPanelLayout({ width: tileWidth, files: files && filesSlot, outline, outlineReady: oc.hasOutline, last: lastPanel }),
  );

  const switchTo = (p: string) => onswitch?.(p, fc.snapshot());
  const fc = createDocFiles({
    seed: swapped?.files ?? null,
    get backend() {
      return backend;
    },
    get path() {
      return path;
    },
    get sourceGone() {
      return sourceGone;
    },
    root: () => rootEl,
    onpick: (p) => (fc.drop ? runOnMenu(() => p, fc.closeDrop, switchTo) : switchTo(p)),
  });

  /** 숨겨진 쪽의 토글도 여기로 온다 · 포커스는 옮기지 않는다 */
  function openPanel(which: DocSidePanel) {
    const close = panelToCloseOnOpen({
      width: tileWidth,
      opening: which,
      files: which === "files" ? false : files,
      outline: which === "outline" ? false : outline,
      outlineReady: oc.hasOutline,
    });
    if (close === "files") onfiles?.(false);
    else if (close === "outline") onoutline?.(false);
    lastPanel = which;
    if (which === "files" && !files) onfiles?.(true);
    else if (which === "outline" && !outline) onoutline?.(true);
  }

  /** 사람이 토글을 누른 때만 `mark` — 두 패널이 한 키를 써야 함께 닫히는 쪽도 같이 움직인다 */
  const panelMotion = createToggleMotion();
  const PANEL_MOTION = "doc-panel";

  function toggleFiles() {
    panelMotion.mark(PANEL_MOTION);
    if (layout.filesShown) onfiles?.(false);
    else openPanel("files");
  }

  function toggleOutline() {
    panelMotion.mark(PANEL_MOTION);
    if (layout.outlineShown) onoutline?.(false);
    else openPanel("outline");
  }

  function toggleFilesDrop() {
    if (fc.drop) fc.closeDrop();
    else {
      oc.closeOutlineDrop();
      fc.openDrop();
    }
  }

  function toggleOutlineDrop() {
    if (oc.outlineDrop) oc.closeOutlineDrop();
    else {
      fc.closeDrop();
      oc.openOutlineDrop();
    }
  }

  const filesLive = $derived(layout.filesShown || fc.drop !== null);
  /** 백엔드 객체가 새로 내려와도 값이 같으면 아래 효과를 깨우지 않는다 */
  const filesSource = $derived(`${backend.key}\n${backend.online}`);

  // 읽기는 제가 쓰는 상태를 읽으므로 `untrack` — 아니면 제가 쓴 값에 다시 깨어난다
  $effect(() => {
    void filesSource;
    if (!filesLive) return;
    untrack(() => void fc.load());
  });

  $effect(() => {
    const keep = layout.narrow && filesSlot;
    if (!keep) untrack(() => fc.closeDrop());
  });

  onDestroy(() => fc.dispose());

  $effect(() => {
    const el = rootEl;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      tileWidth = entries[0]?.contentRect.width ?? 0;
      oc.scheduleTrack();
    });
    ro.observe(el);
    return () => ro.disconnect();
  });

  // 마크업 속성으로 달지 않는다 — 정적 상자에 손잡이를 붙이면 a11y 경고가 난다
  $effect(() => {
    const el = bodyEl;
    if (!el) return;
    const release = () => oc.releasePick();
    el.addEventListener("scroll", oc.scheduleTrack, { passive: true });
    el.addEventListener("wheel", release, { passive: true });
    el.addEventListener("pointerdown", release, { passive: true });
    return () => {
      el.removeEventListener("scroll", oc.scheduleTrack);
      el.removeEventListener("wheel", release);
      el.removeEventListener("pointerdown", release);
    };
  });

  let pageEl = $state<HTMLDivElement | null>(null);
  $effect(() => {
    const el = pageEl;
    if (!el) return;
    const ro = new ResizeObserver(() => oc.scheduleTrack());
    ro.observe(el);
    return () => ro.disconnect();
  });

  $effect(() => {
    void oc.outlineItems;
    void oc.panelOpen;
    void oc.narrow;
    untrack(() => void tick().then(oc.scheduleTrack));
  });

  $effect(() => {
    const keep = oc.narrow && oc.hasOutline;
    if (!keep) untrack(() => oc.closeOutlineDrop());
  });

  onDestroy(() => {
    oc.dispose();
  });

  // ── 띠의 [비교] ──
  // 디스크를 따로 읽는다 — `dc.load` · `accept` 와 섞지 않는다(편집 상태 · 띠 · 기준 version 은 그대로).

  let compare = $state<CompareResult | null>(null);
  let compareBusy = $state(false);
  /** 늦게 온 읽기가 닫은 뒤 · 새 [비교] 뒤에 보기를 세우지 않게 */
  let compareSeq = 0;
  let compareEl = $state<HTMLDivElement | null>(null);

  function compareBand(): boolean {
    const b = dc.bands.band;
    return dc.editing && b !== null && b.kind !== "unsaved";
  }

  async function openCompare() {
    if (!compareBand() || compareBusy || offline || !backend.readText) return;
    const my = ++compareSeq;
    compareBusy = true;
    try {
      const got = await backend.readText(path);
      if (my !== compareSeq || !compareBand() || !editor) return;
      if (got.binary || got.truncated) {
        onnotice?.(t("files.doc.compare.unreadable"));
        return;
      }
      compare = compareTexts(got.text, editor.getText());
    } catch (e) {
      if (my !== compareSeq) return;
      onnotice?.(t("files.doc.compare.failed", { message: stripReason(e instanceof Error ? e.message : String(e)) }));
    } finally {
      if (my === compareSeq) compareBusy = false;
    }
  }

  function closeCompare(focus: boolean) {
    compareSeq++;
    compareBusy = false;
    compare = null;
    if (focus) void tick().then(() => editor?.focus());
  }

  $effect(() => {
    if (compareBand()) return;
    untrack(() => {
      if (compare === null && !compareBusy) return;
      const inside = compareEl?.contains(document.activeElement) ?? false;
      closeCompare(dc.editing && inside);
    });
  });

  // ── 문서 안 검색 (Ctrl+F) ──

  let finder = $state<ReturnType<typeof DomFindBar> | null>(null);
  const findable = $derived(
    (dc.editing && compare !== null) || (!dc.editing && dc.file !== null && !dc.file.binary && text !== ""),
  );

  /** 찾을 글이 없으면 `false` — 터미널 검색으로 넘어간다 */
  function openFind(): boolean {
    if (dc.editing && compare !== null) return finder?.show() ?? false;
    if (dc.editing) {
      if (!editor) return false;
      editor.openSearch();
      return true;
    }
    if (!findable) return false;
    return finder?.show() ?? false;
  }

  $effect(() => {
    if (!findable) untrack(() => finder?.close());
  });

  // ── 본문 우클릭 메뉴 ──
  // 링크 · 고른 글은 누른 순간의 것을 묶어 둔다 — 메뉴가 떠 있는 동안 포커스가 메뉴로 가 선택이 바뀔 수 있다.

  const readActions: ReadMenuActions = {
    editing: () => dc.editing,
    openLink,
    openDocLink,
    openPreviewDocLink,
    openFind,
    startEdit: dc.startEdit,
  };

  function onBodyContextMenu(ev: MouseEvent) {
    if (ev.defaultPrevented || !onmenu) return;
    const target = ev.target instanceof Element ? ev.target : null;
    if (!target || target.closest("input, textarea")) return;
    ev.preventDefault();
    if (target.closest(".cm-editor") && editor) {
      const ed = editor;
      const hist = ed.historyState();
      const sel = ed.selectedText();
      const rows = docMenuItems(
        { mode: "edit", link: null, hasSelection: sel !== "", canFind: true, canEdit: false, markdown, canUndo: hist.undo, canRedo: hist.redo },
        t,
      );
      onmenu(ev.clientX, ev.clientY, { rows, run: (key) => runEditMenu(ed, key, sel, dc.save) });
      return;
    }
    const box = (compare !== null ? compareEl : dc.editing ? previewPageEl : rendered ? pageEl : bodyEl?.querySelector("[data-code-view]")) ?? bodyEl;
    if (!box) return;
    const link = target.closest("[data-href]")?.getAttribute("data-href") ?? null;
    const sel = selectionIn(box);
    const canEdit = !dc.editing && dc.file !== null && editBlockOf(dc.file) === null && backend.canWrite && !offline;
    const rows = docMenuItems(
      {
        mode: "read",
        link,
        hasSelection: sel !== "",
        canFind: findable,
        canEdit,
        markdown: false,
        canUndo: false,
        canRedo: false,
        newDoc: paneId ? newDocState(paneId) : null,
      },
      t,
    );
    onmenu(ev.clientX, ev.clientY, { rows, run: (key) => runReadMenu(key, { box, link, sel }, readActions) });
  }

  $effect(() => {
    const id = paneId;
    if (!id) return;
    return untrack(() => registerTileFind(id, openFind));
  });

  // ── 편집 중 미리 보기 (마크다운) ──

  const mdEdit = $derived(dc.editing && markdown);
  /** 저장하지 않는 한때 값 */
  let narrowTab = $state<NarrowEditTab>("source");
  const editWidth = $derived(layout.bodyW || tileWidth);
  const wideEdit = $derived(isWideEdit(editWidth));
  const editShown = $derived<DocEditView>(mdEdit ? visibleEditView(editView, editWidth, narrowTab) : "source");
  const showPreview = $derived(mdEdit && editShown !== "source");
  /** 끄는 동안의 비율 — 놓을 때 한 번 적는다(끄는 동안 배치 자동 저장을 두드리지 않게) */
  let dragSplit = $state<number | null>(null);
  let splitDrag: { left: number; width: number } | null = null;
  const splitRatio = $derived(dragSplit ?? clampDocSplit(split ?? DOC_SPLIT_DEFAULT));
  let syncScroll = $state(true);
  const syncOn = $derived(mdEdit && syncScroll && editShown === "split");

  let previewText = $state("");
  const PREVIEW_DELAY_MS = 200;
  let previewTimer: ReturnType<typeof setTimeout> | null = null;
  const previewBlocks = $derived(showPreview ? parseMarkdown(previewText, DOC_TILE_MD) : []);

  // ── 그림 ──

  const images = new DocImageCache();

  $effect(() => {
    const srcs = [...imageSrcsOf(blocks), ...imageSrcsOf(previewBlocks)];
    const ctx = { backend, docPath: path, remote: backend.key !== LOCAL_KEY, gen: dc.file?.version ?? "" };
    void backend.online;
    untrack(() => images.sync(srcs, ctx));
  });

  onDestroy(() => images.dispose());
  const previewSections = $derived(showPreview ? sectionLines(previewText, previewBlocks, DOC_TILE_MD) : []);
  let previewEl = $state<HTMLDivElement | null>(null);
  let splitEl = $state<HTMLDivElement | null>(null);

  /** 0 기준 */
  let cursorLine = $state(0);
  let edView = $state<EditorViewport>({ top: 0, bottom: Number.POSITIVE_INFINITY });
  const cursorSlug = $derived(syncOn ? syncTarget(previewSections, cursorLine, { top: cursorLine, bottom: cursorLine }) : null);
  const syncSlug = $derived(syncOn ? syncTarget(previewSections, cursorLine, edView) : null);

  function stopPreviewTimer() {
    if (previewTimer) clearTimeout(previewTimer);
    previewTimer = null;
  }

  function previewOnEditStart(text: string) {
    previewText = text;
    narrowTab = narrowTabOf(editView);
    cursorLine = 0;
    edView = { top: 0, bottom: Number.POSITIVE_INFINITY };
  }

  function previewOnEditReload(text: string) {
    stopPreviewTimer();
    previewText = text;
    cursorLine = 0;
    edView = { top: 0, bottom: Number.POSITIVE_INFINITY };
  }

  function editorChanged() {
    if (!markdown) return;
    stopPreviewTimer();
    previewTimer = setTimeout(() => {
      previewTimer = null;
      if (dc.editing && editor) previewText = editor.getText();
    }, PREVIEW_DELAY_MS);
  }

  function flushPreview() {
    stopPreviewTimer();
    if (dc.editing && editor) previewText = editor.getText();
  }

  function scrollPreviewTo(slug: string | null) {
    const box = previewEl;
    if (!box) return;
    if (slug === null) box.scrollTo({ top: 0 });
    else scrollBoxToAnchor(box, slug);
  }

  async function revealPreviewAtCursor() {
    flushPreview();
    await tick();
    const line = editor?.cursorLine() ?? cursorLine;
    scrollPreviewTo(syncTarget(previewSections, line, { top: line, bottom: line }));
  }

  function pickEditView(v: DocEditView) {
    const was = editShown;
    if (v !== editView) oneditview?.(v);
    if (was === "source" && v !== "source") void revealPreviewAtCursor();
    else if (v !== "preview") void tick().then(() => editor?.focus());
  }

  function pickNarrowTab(tab: NarrowEditTab) {
    if (tab === narrowTab) return;
    narrowTab = tab;
    if (tab === "preview") void revealPreviewAtCursor();
  }

  function narrowTabKey(ev: KeyboardEvent) {
    if (ev.key !== "ArrowLeft" && ev.key !== "ArrowRight") return;
    ev.preventDefault();
    const next: NarrowEditTab = narrowTab === "source" ? "preview" : "source";
    pickNarrowTab(next);
    void tick().then(() => rootEl?.querySelector<HTMLElement>(`[data-edit-tab="${next}"]`)?.focus());
  }

  /** 스크롤 맞추기가 마지막으로 데려간 절(`null` = 맨 위) — 사람이 미리 보기를 직접 밀면 `undefined`(그 자리는 건드리지 않는다) */
  let alignedSlug: string | null | undefined = undefined;
  let previewPageEl = $state<HTMLDivElement | null>(null);
  let realignFrame = 0;

  // 데려갈 절이 바뀔 때만 민다 — 같은 절 안에서 치는 동안은 사람이 밀어 둔 미리 보기 그대로
  $effect(() => {
    const slug = syncSlug;
    if (!syncOn) return;
    untrack(
      () =>
        void tick().then(() => {
          alignedSlug = slug;
          scrollPreviewTo(slug);
        }),
    );
  });

  $effect(() => {
    const el = previewEl;
    if (!el) return;
    const release = () => (alignedSlug = undefined);
    el.addEventListener("wheel", release, { passive: true });
    el.addEventListener("pointerdown", release, { passive: true });
    return () => {
      el.removeEventListener("wheel", release);
      el.removeEventListener("pointerdown", release);
    };
  });

  $effect(() => {
    const el = previewPageEl;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      if (realignFrame) return;
      realignFrame = requestAnimationFrame(() => {
        realignFrame = 0;
        if (syncOn && alignedSlug !== undefined) scrollPreviewTo(alignedSlug);
      });
    });
    ro.observe(el);
    return () => ro.disconnect();
  });

  onDestroy(() => {
    if (realignFrame) cancelAnimationFrame(realignFrame);
  });

  // 다시 그리면 제목 요소가 새로 설 수 있어 그릴 때마다 다시 단다
  $effect(() => {
    const el = previewEl;
    const slug = cursorSlug;
    void previewBlocks;
    if (!el) return;
    untrack(
      () =>
        void tick().then(() => {
          for (const h of el.querySelectorAll(".sync-hl")) h.classList.remove("sync-hl");
          if (slug) el.querySelector(`[data-slug="${CSS.escape(slug)}"]`)?.classList.add("sync-hl");
        }),
    );
  });

  function openPreviewDocLink(href: string) {
    const c = classifyDocHref(href);
    if (c.kind === "anchor") {
      if (previewEl) scrollBoxToAnchor(previewEl, c.anchor);
    } else if (c.kind === "path") onopenlink?.(c.path, c.anchor);
  }

  function startSplitDrag(ev: PointerEvent) {
    if (ev.button !== 0 || !splitEl) return;
    const r = splitEl.getBoundingClientRect();
    if (r.width <= 0) return;
    splitDrag = { left: r.left, width: r.width };
    dragSplit = splitRatio;
    (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);
    ev.preventDefault();
  }

  function moveSplitDrag(ev: PointerEvent) {
    if (!splitDrag) return;
    dragSplit = splitAt(ev.clientX, splitDrag.left, splitDrag.width);
  }

  function endSplitDrag(ev: PointerEvent) {
    if (!splitDrag) return;
    splitDrag = null;
    const r = dragSplit;
    dragSplit = null;
    const el = ev.currentTarget as HTMLElement;
    if (el.hasPointerCapture(ev.pointerId)) el.releasePointerCapture(ev.pointerId);
    if (r !== null) onsplit?.(r);
  }

  function splitKey(ev: KeyboardEvent) {
    const step = ev.key === "ArrowLeft" ? -0.05 : ev.key === "ArrowRight" ? 0.05 : 0;
    if (step === 0) return;
    ev.preventDefault();
    onsplit?.(clampDocSplit(splitRatio + step));
  }

  // ── 글자 크기 ──

  provideDocZoom(() => zoom);

  let zoomAnchor: { el: HTMLElement; ratio: number } | null = null;

  function setZoom(next: number) {
    if (next === zoom) return;
    const el = scroller();
    zoomAnchor = el && el.scrollHeight > 0 ? { el, ratio: el.scrollTop / el.scrollHeight } : null;
    onzoom?.(next);
  }

  // 목차 지금 절 · 미리 보기 맞추기 · mermaid 맞춤 폭은 각자의 `ResizeObserver` 가 내용 크기 변화로 잡는다
  $effect(() => {
    void zoom;
    untrack(() =>
      void tick().then(() => {
        editor?.remeasure();
        const a = zoomAnchor;
        zoomAnchor = null;
        if (a && a.el.isConnected) a.el.scrollTop = a.ratio * a.el.scrollHeight;
      }),
    );
  });

  /** 확대한 mermaid 상자의 높이 상한(본문 높이의 80%) — `70vh` 는 창 기준이라 짧은 타일에서 다이어그램 밀기와 문서 밀기가 엉킨다 */
  let bodyH = $state(0);
  $effect(() => {
    const el = bodyEl;
    if (!el) return;
    const ro = new ResizeObserver((entries) => (bodyH = entries[0]?.contentRect.height ?? 0));
    ro.observe(el);
    return () => ro.disconnect();
  });
  const mermaidMax = $derived(bodyH > 0 ? `${Math.round(bodyH * 0.8)}px` : null);

  // `Ctrl+휠` — 한 눈금마다 한 단계(터치패드 집기가 끝까지 튀지 않게). passive 가 아니어야 `preventDefault` 로 페이지 스크롤을 막는다
  const ZOOM_WHEEL_STEP = 50;
  let zoomWheelAcc = 0;
  $effect(() => {
    const el = bodyEl;
    if (!el) return;
    const onWheel = (ev: WheelEvent) => {
      if (!ev.ctrlKey || ev.defaultPrevented) return;
      if ((ev.target as Element | null)?.closest?.("[data-mermaid]")) return;
      ev.preventDefault();
      zoomWheelAcc += ev.deltaMode === 0 ? ev.deltaY : ev.deltaY * 40;
      if (Math.abs(zoomWheelAcc) < ZOOM_WHEEL_STEP) return;
      const d = zoomWheelAcc;
      zoomWheelAcc = 0;
      setZoom(wheelDocZoom(zoom, d));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  });

  const LINE_PX = 40;

  function onkeydown(ev: KeyboardEvent) {
    // 편집기 안이면 편집기가 이미 잡았다(`defaultPrevented`) — 도구줄 · 띠에 포커스가 있어도 저장
    if (dc.editing && !ev.defaultPrevented && ev.ctrlKey && !ev.altKey && !ev.shiftKey && !ev.metaKey && ev.code === "KeyS") {
      ev.preventDefault();
      void dc.save();
      return;
    }
    if (dc.editing) return;
    if (ev.ctrlKey || ev.altKey || ev.metaKey) return;
    const target = ev.target as HTMLElement | null;
    if (target && target.closest("button, input, textarea, select, .cm-editor")) return;
    oc.releasePick();
    const el = scroller();
    if (!el) return;
    const page = Math.max(LINE_PX, el.clientHeight * 0.9);
    let handled = true;
    switch (ev.key) {
      case "ArrowDown":
        el.scrollBy({ top: LINE_PX });
        break;
      case "ArrowUp":
        el.scrollBy({ top: -LINE_PX });
        break;
      case "ArrowRight":
        el.scrollBy({ left: LINE_PX });
        break;
      case "ArrowLeft":
        el.scrollBy({ left: -LINE_PX });
        break;
      case "PageDown":
        el.scrollBy({ top: page });
        break;
      case "PageUp":
        el.scrollBy({ top: -page });
        break;
      case "Home":
        el.scrollTo({ top: 0 });
        break;
      case "End":
        el.scrollTo({ top: el.scrollHeight });
        break;
      default:
        handled = false;
    }
    if (handled) ev.preventDefault();
  }
  const inHead = $derived(!!paneId && paneHeadShown(paneId));
  $effect(() => {
    const id = paneId;
    if (!id) return;
    return setPaneTools(id, {
      bar: docBar,
      tail: docTail,
      keepBar: true,
      fileMenu: () => docExternalItems({ canOpenExternal: backend.canOpenExternal, canEdit: backend.canEdit, offline }, t),
      run: (key) => {
        if (key === DOC_TOOL_EXTERNAL) void dc.openExternally();
        else if (key === DOC_TOOL_EDIT_EXTERNAL) void dc.editRemote();
      },
    });
  });
</script>

{#snippet filesToggle(head: boolean)}
  <button
    type="button"
    class={head ? "side-toggle inhead" : "btn ico"}
    data-head-act
    class:on={!head && layout.filesShown}
    aria-pressed={layout.filesShown}
    title={t("files.doc.files")}
    aria-label={t("files.doc.files")}
    onclick={toggleFiles}><UiIcon name="side-panel" size={head ? 14 : 13} /></button
  >
{/snippet}

{#snippet filesDropButton(head: boolean)}
  <button
    type="button"
    class={head ? "side-drop inhead" : "btn side-drop"}
    data-head-act
    bind:this={fc.button}
    title={t("files.doc.files.drop.title", { folder: fc.dirName })}
    aria-label={t("files.doc.files.drop.title", { folder: fc.dirName })}
    aria-haspopup="dialog"
    aria-expanded={fc.drop !== null}
    onclick={toggleFilesDrop}
    ><UiIcon name="side-panel" size={head ? 14 : 13} /><UiIcon name="chevron-down" size={12} /></button
  >
{/snippet}

{#snippet outlineToggle()}
  <button
    type="button"
    class="btn ico"
    data-head-act
    class:on={layout.outlineShown}
    aria-pressed={layout.outlineShown}
    disabled={!oc.hasOutline}
    title={oc.hasOutline ? t("files.doc.outline") : t("files.doc.outline.none")}
    aria-label={t("files.doc.outline")}
    onclick={toggleOutline}><UiIcon name="preview" size={13} /></button
  >
{/snippet}

{#snippet outlineDropButton()}
  <button
    type="button"
    class="btn side-drop"
    data-head-act
    bind:this={oc.outlineButton}
    title={t("files.doc.outline.drop.title", { name: oc.curName })}
    aria-label={t("files.doc.outline.drop.title", { name: oc.curName })}
    aria-haspopup="dialog"
    aria-expanded={oc.outlineDrop !== null}
    onclick={toggleOutlineDrop}
    ><UiIcon name="preview" size={13} /><UiIcon name="chevron-down" size={12} /></button
  >
{/snippet}

{#snippet docTail()}
  {#if filesSlot}
    {#if layout.narrow}{@render filesDropButton(true)}{:else}{@render filesToggle(true)}{/if}
  {/if}
{/snippet}

{#snippet docBar(head: boolean)}
  <DocToolbar
    {head}
    {filesSlot}
    {filesToggle}
    {filesDropButton}
    outlineSlot={oc.outlineSlot}
    narrow={layout.narrow}
    hasOutline={oc.hasOutline}
    {outlineToggle}
    {outlineDropButton}
    {mdEdit}
    {wideEdit}
    {editView}
    {pickEditView}
    {editShown}
    bind:syncScroll
    {narrowTab}
    {narrowTabKey}
    {pickNarrowTab}
    {zoom}
    {setZoom}
    {preview}
    {keep}
    editing={dc.editing}
    {onunkeep}
    {unkeep}
    dirty={dc.dirty}
    savedFlash={dc.savedFlash}
    saving={dc.saving}
    {offline}
    save={dc.save}
    endEdit={dc.endEdit}
    {markdown}
    {rendered}
    {onmode}
    {showEdit}
    {editTitle}
    editBlock={dc.editBlock}
    startEdit={dc.startEdit}
    {backend}
    openExternally={dc.openExternally}
    editRemote={dc.editRemote}
    {autoInfo}
    bind:infoNow
    loading={dc.loading}
    load={dc.load}
  />
{/snippet}

<div
  class="doc"
  role="presentation"
  tabindex="-1"
  data-tile-focus
  bind:this={rootEl}
  style:--doc-zoom={zoom / 100}
  style:--doc-mmd-max={mermaidMax}
  {onkeydown}
>
  {#if !inHead}{@render docBar(false)}{/if}

  <DomFindBar
    bind:this={finder}
    root={compare !== null ? compareEl : bodyEl}
    scroller={() => (compare !== null ? compareEl : scroller())}
    label={t("files.doc.find")}
    onclose={() => (compare !== null ? compareEl : rootEl)?.focus({ preventScroll: true })}
  />

  {#if fc.drop}
    <button
      type="button"
      class="menu-backdrop"
      tabindex="-1"
      aria-label={t("files.menu.close.aria")}
      onclick={fc.closeDrop}
      oncontextmenu={(ev) => {
        ev.preventDefault();
        fc.closeDrop();
      }}
    ></button>
    <div
      class="files-pop menu-surface"
      role="dialog"
      aria-label={t("files.doc.files")}
      style:left={`${fc.drop.x}px`}
      style:top={`${fc.drop.y}px`}
      style:width={`${fc.drop.w}px`}
      style:max-height={`${fc.drop.maxH}px`}
    >
      <DocFiles {fc} variant="drop" />
    </div>
  {/if}

  {#if oc.outlineDrop}
    <button
      type="button"
      class="menu-backdrop"
      tabindex="-1"
      aria-label={t("files.menu.close.aria")}
      onclick={oc.closeOutlineDrop}
      oncontextmenu={(ev) => {
        ev.preventDefault();
        oc.closeOutlineDrop();
      }}
    ></button>
    <div
      class="outline-pop menu-surface"
      role="dialog"
      aria-label={t("files.doc.outline")}
      style:left={`${oc.outlineDrop.x}px`}
      style:top={`${oc.outlineDrop.y}px`}
      style:width={`${oc.outlineDrop.w}px`}
      style:max-height={`${oc.outlineDrop.maxH}px`}
    >
      <DocOutline
        items={oc.outlineItems}
        current={oc.curIdx}
        variant="drop"
        onpick={(it) => runOnMenu(() => it, oc.closeOutlineDrop, oc.pickOutline)}
        onescape={oc.escapeOutlineDrop}
      />
    </div>
  {/if}

  {#if dc.editing && dc.bands.band}
    {@const band = dc.bands.band}
    {#if band.kind === "conflict" || band.kind === "changed"}
      <p class="banner wait" role="alert">
        <span class="err-text">{t("files.doc.conflict")}</span>
        <span class="acts">
          <button
            type="button"
            class="retry primary"
            disabled={offline || compareBusy || !backend.readText}
            aria-busy={compareBusy}
            onclick={() => void openCompare()}
            >{compareBusy ? t("files.doc.compare.busy") : t("files.doc.compare")}</button
          >
          <button
            type="button"
            class="retry"
            disabled={offline || dc.loading}
            onclick={() => {
              closeCompare(false);
              void dc.reloadForEdit();
            }}>{t("files.doc.conflict.reload")}</button
          >
          {#if band.kind === "conflict"}
            <button
              type="button"
              class="retry"
              disabled={offline || dc.saving}
              onclick={() => {
                closeCompare(false);
                void dc.save(true);
              }}>{t("files.doc.conflict.overwrite")}</button
            >
            <button type="button" class="retry" onclick={dc.dismissBand}
              >{t("files.doc.conflict.cancel")}</button
            >
          {:else}
            <button type="button" class="retry" onclick={dc.ignoreBand}
              >{t("files.doc.conflict.ignore")}</button
            >
          {/if}
        </span>
      </p>
    {:else}
      <p class="banner err" role="alert">
        <span class="err-text"
          >{band.why === "gone"
            ? t("files.doc.unsaved.gone")
            : band.why === "missing"
              ? t("files.doc.unsaved.missing")
              : t("files.doc.unsaved.error", { message: band.message ?? "" })}</span
        >
        <button type="button" class="retry" onclick={dc.dismissBand}
          >{t("files.doc.band.dismiss")}</button
        >
      </p>
    {/if}
  {/if}

  {#if sourceGone}
    <p class="banner gone">{t("files.browser.source.gone")}</p>
  {:else if offline}
    <p class="banner wait">
      {alias ? t("files.browser.offline.alias", { alias }) : t("files.browser.offline")}
    </p>
  {/if}

  {#if heldDraft && !dc.editing}
    <p class="banner {draftBlock === 'wait' || draftBlock === 'offline' || draftBlock === null ? 'wait' : 'err'}" role="alert">
      <span class="err-text">{t(`files.doc.draft.${draftBlock ?? "wait"}`)}</span>
      <span class="acts">
        {#if draftBlock === "read" || draftBlock === "editor"}
          <button type="button" class="retry" disabled={offline} onclick={retryDraft}>{t("files.browser.retry")}</button>
        {/if}
        <button type="button" class="retry" onclick={() => void copyDraft()}>{t("files.doc.draft.copy")}</button>
        <button type="button" class="retry" onclick={() => void discardDraft()}>{t("files.doc.draft.discard")}</button>
      </span>
    </p>
  {/if}

  {#if dc.error}
    <p class="banner err">
      <span class="err-text">{dc.error}</span>
      <button type="button" class="retry" onclick={() => void dc.load()} disabled={offline}>
        {t("files.browser.retry")}
      </button>
    </p>
  {/if}

  {#if dc.file && !dc.file.binary}
    {#if dc.file.truncated}
      <!-- 두 수를 같은 형식기(`formatSize`)로 — 단위가 섞이면 비교가 안 된다 -->
      <p class="band">
        {t("files.doc.truncated", { shown: formatSize(TEXT_VIEW_MAX_BYTES), size: formatSize(dc.file.size) })}
      </p>
    {/if}
    {#if dc.file.lossy}
      <p class="band">{t("files.doc.lossy")}</p>
    {/if}
    {#if plain}
      <p class="band">{t("files.doc.plain")}</p>
    {/if}
  {/if}

  <div class="content" style:--files-w="{DOC_FILES_PANEL_W}px" style:--outline-w="{DOC_OUTLINE_PANEL_W}px">
    {#if layout.filesShown}
      <div class="files-panel" transition:sidePanelGrow={{ motion: panelMotion, key: PANEL_MOTION }}>
        <div class="side-inner">
          <DocFiles {fc} variant="panel" />
        </div>
      </div>
    {/if}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="body" class:md={rendered} bind:this={bodyEl} oncontextmenu={onBodyContextMenu}>
      {#if dc.editing && dc.file}
        <DocEditPane
          bind:editor
          bind:splitEl
          bind:previewEl
          bind:previewPageEl
          editGen={dc.editGen}
          text={dc.editText}
          restore={dc.editRestore}
          onready={editorReady}
          {path}
          {editShown}
          {splitRatio}
          dragging={dragSplit !== null}
          {showPreview}
          {previewBlocks}
          {images}
          tasks={editTasks}
          save={dc.save}
          setDirty={dc.setDirty}
          {editorChanged}
          oncursor={(line) => (cursorLine = line)}
          onviewport={(top, bottom) => (edView = { top, bottom })}
          editorFailed={onEditorFailed}
          {startSplitDrag}
          {moveSplitDrag}
          {endSplitDrag}
          {splitKey}
          {onsplit}
          {openLink}
          {openPreviewDocLink}
          onjump={(el) => previewEl && scrollBoxToEl(previewEl, el)}
          {codeActions}
          covered={compare !== null}
        />
        {#if compare !== null}
          <DocCompareView bind:scrollEl={compareEl} result={compare} wide={wideEdit} onback={() => closeCompare(true)} />
        {/if}
      {:else if dc.file === null}
        {#if dc.loading}<p class="note">{t("files.doc.loading")}</p>{/if}
      {:else if dc.file.binary}
        <div class="binary">
          <p class="note">{t("files.doc.binary")}</p>
          {#if backend.canOpenExternal}
            <button type="button" class="retry" onclick={() => void dc.openExternally()}>{t("files.menu.openexternal")}</button>
          {/if}
          {#if backend.canEdit}
            <button type="button" class="retry" disabled={offline} onclick={() => void dc.editRemote()}
              >{t("files.menu.edit.external")}</button
            >
          {/if}
        </div>
      {:else if text === ""}
        <p class="note">{t("files.doc.empty")}</p>
      {:else if rendered}
        <div class="md-page" bind:this={pageEl}>
          <MarkdownBlocks
            {blocks}
            onlink={openLink}
            ondoclink={openDocLink}
            onjump={(el) => bodyEl && scrollBoxToEl(bodyEl, el)}
            diagrams
            tasks={readTasks}
            {images}
            {codeActions}
          />
        </div>
      {:else}
        <CodeView code={text} {lang} lineNumbers fill flashLine={codeFlash} />
      {/if}
    </div>
    {#if oc.panelOpen}
      <nav
        class="outline-panel"
        aria-label={t("files.doc.outline")}
        transition:sidePanelGrow={{ motion: panelMotion, key: PANEL_MOTION }}
      >
        <div class="side-inner">
          <DocOutline
            items={oc.outlineItems}
            current={oc.curIdx}
            variant="panel"
            onpick={oc.pickOutline}
            onescape={() => rootEl?.focus({ preventScroll: true })}
          />
        </div>
      </nav>
    {/if}
  </div>
</div>

<style>
  .doc {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    /* 글래스 크롬 타일이면 판은 타일 상자가 한 번 칠한다 — 여기는 `--tile-inner`(투명) */
    background: var(--tile-inner, var(--bg-panel));
    color: var(--fg);
    font-family: var(--font-ui);
  }

  .doc:focus {
    outline: none;
  }

  /* 포커스 밖에서 접힐 때 지울 앞 간격 = 머리줄 `gap`(`--head-act-gap` — `PaneHeader` "드러냄" 절) */
  .side-toggle.inhead {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
    width: 24px;
    height: 24px;
    margin: 0;
    padding: 0;
    color: var(--fg-3);
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    cursor: pointer;
    overflow: hidden;
    --head-act-gap: var(--space-2);
  }

  .side-toggle.inhead:hover:not(:disabled) {
    color: var(--fg-2);
    background: color-mix(in srgb, var(--fg) 7%, var(--surface-hover));
  }

  .side-toggle.inhead:active:not(:disabled) {
    color: var(--fg-1);
    background: color-mix(in srgb, var(--fg) 11%, var(--surface-hover));
  }

  .side-toggle.inhead:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: -2px;
  }

  .side-toggle.inhead:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .btn {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    min-height: 1.4em;
    padding: 3px 7px;
    font-family: var(--font-ui);
    font-size: 11px;
    line-height: 1.4;
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
    height: 24px;
    padding: 0;
  }

  .menu-backdrop {
    position: fixed;
    inset: 0;
    z-index: 40;
    padding: 0;
    background: transparent;
    border: none;
    cursor: default;
  }

  .btn.on {
    color: var(--fg);
    background: var(--accent-soft);
  }

  .banner,
  .band {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
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

  .banner.gone,
  .banner.err {
    color: var(--err);
    background: var(--err-soft);
  }

  .band {
    color: var(--fg-2);
    background: var(--surface-hover);
  }

  /* 바탕 폭 16em — 없으면 긴 문구가 넓은 타일에서도 단추를 밀어 내리고, 줄게만 두면 `overflow-wrap: anywhere` 탓에 한 글자 폭까지 눌린다 */
  .err-text {
    flex: 1 1 16em;
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .acts {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    max-width: 100%;
  }

  .retry {
    flex: 0 0 auto;
    padding: 2px 8px;
    font-family: var(--font-ui);
    font-size: 11px;
    color: var(--fg);
    background: transparent;
    border: 1px solid var(--border);
    border-radius: var(--radius);
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
    border-color: var(--accent);
  }

  .retry.primary:hover:not(:disabled) {
    background: var(--accent-hover);
  }

  .content {
    display: flex;
    flex: 1 1 auto;
    min-height: 0;
  }

  /* 폭 = `doc-side-panels.ts` 의 `DOC_FILES_PANEL_W` · `DOC_OUTLINE_PANEL_W`, 경계선 1px = `DOC_PANEL_LINE_W` */
  .files-panel {
    flex: 0 0 var(--files-w);
    width: var(--files-w);
    min-height: 0;
    overflow: hidden;
    border-right: 1px solid var(--line);
  }

  .outline-panel {
    flex: 0 0 var(--outline-w);
    width: var(--outline-w);
    min-height: 0;
    overflow: hidden;
    border-left: 1px solid var(--line);
  }

  /* 안쪽은 늘 패널 폭 — 여닫는 동안(`sidePanelGrow` 는 바깥 폭만 키운다) 줄이 다시 흐르지 않는다 */
  .files-panel,
  .outline-panel {
    display: flex;
  }

  .files-panel {
    justify-content: flex-end;
  }

  .files-panel > .side-inner {
    flex: 0 0 var(--files-w);
    width: var(--files-w);
  }

  .outline-panel > .side-inner {
    flex: 0 0 var(--outline-w);
    width: var(--outline-w);
  }

  .side-inner {
    height: 100%;
    min-height: 0;
  }

  .files-pop,
  .outline-pop {
    position: fixed;
    z-index: 41;
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
    overflow: hidden;
  }

  .btn.side-drop {
    flex: 0 0 auto;
    height: 24px;
    gap: 2px;
    padding: 0 5px;
  }

  /* 왼쪽 안쪽 여백 (24 − 14) / 2 = 5px — 아이콘이 토글의 아이콘과 같은 x 에 선다 */
  .side-drop.inhead {
    /* 줄면 ▾ 부터 잘린다 */
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 2px;
    box-sizing: border-box;
    height: 24px;
    margin: 0;
    padding: 0 5px;
    font-family: var(--font-ui);
    font-size: 11px;
    color: var(--fg-3);
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    cursor: pointer;
    overflow: hidden;
    --head-act-gap: var(--space-2);
  }

  .side-drop.inhead :global(svg) {
    flex: 0 0 auto;
  }

  .side-drop.inhead:hover {
    color: var(--fg-2);
    background: color-mix(in srgb, var(--fg) 7%, var(--surface-hover));
  }

  .side-drop.inhead:active {
    color: var(--fg-1);
    background: color-mix(in srgb, var(--fg) 11%, var(--surface-hover));
  }

  .side-drop.inhead:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: -2px;
  }

  /* `.btn.on` 과 같은 강조 면 — 문서 · DB 타일의 곁 패널 단추는 한 규칙이다 */
  .side-toggle.inhead[aria-pressed="true"],
  .side-drop[aria-expanded="true"] {
    color: var(--fg);
    background: var(--accent-soft);
  }

  .body {
    flex: 1 1 auto;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    user-select: text;
  }

  .body.md {
    overflow: auto;
  }

  .md-page {
    max-width: 920px;
    margin: 0 auto;
    padding: var(--space-4) var(--space-5);
    font-size: calc(var(--t-sm) * var(--doc-zoom, 1));
    line-height: 1.6;
    color: var(--fg-1);
  }

  .md-page :global(.line-flash) {
    border-radius: var(--radius);
    animation: doc-line-flash 2s ease-out forwards;
  }

  @keyframes -global-doc-line-flash {
    from {
      background-color: var(--accent-soft);
      box-shadow: 0 0 0 4px var(--accent-soft);
    }
    to {
      background-color: transparent;
      box-shadow: 0 0 0 4px transparent;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .md-page :global(.line-flash) {
      animation: none;
      background-color: var(--accent-soft);
      box-shadow: 0 0 0 4px var(--accent-soft);
    }
  }

  .note {
    margin: 0;
    padding: var(--space-4);
    font-size: 12px;
    color: var(--fg-2);
  }

  .binary {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    padding-right: var(--space-4);
  }
</style>
