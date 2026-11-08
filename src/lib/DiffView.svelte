<script lang="ts">
  import { tick, untrack } from "svelte";
  import UiIcon from "$lib/UiIcon.svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { paneHeadShown, setPaneTools } from "$lib/pane/pane-tools.svelte.js";
  import { projectById } from "$lib/app/project-list.svelte.js";
  import { liveSessionFor } from "$lib/app/remote-home.svelte.js";
  import DomFindBar from "$lib/DomFindBar.svelte";
  import FilesPane from "$lib/diff/FilesPane.svelte";
  import ScopeBar from "$lib/diff/ScopeBar.svelte";
  import CommentTray from "$lib/diff/CommentTray.svelte";
  import PatchView from "$lib/diff/PatchView.svelte";
  import { createDiffComments } from "$lib/diff/comments-controller.svelte.js";
  import { registerTileFind } from "$lib/app/tile-find";
  import { comboFromEvent, effectiveCombo, isEditableTarget } from "$lib/keybindings";
  import { settings } from "$lib/settings.svelte.js";
  import {
    noteDiff,
    openDiffDoc,
    readDiffFile,
    readDiffFiles,
    type DiffFileRead,
    type DiffFilesRead,
  } from "$lib/app/diff-view.svelte.js";
  import {
    commentBelongs,
    commentEntryKey,
    selectionKeys,
    type DiffComment,
    type DiffCommentWhere,
  } from "$lib/diff-comments";
  import { isRemote } from "$lib/projects";
  import {
    canSplit,
    chunks,
    docBlock,
    effectiveView,
    entriesTotal,
    entryKey,
    isNarrow,
    lineKey,
    ROW_CHUNK,
    pickEntry,
    shortHash,
    splitPath,
    splitRows,
    stepEntry,
    unifiedRows,
    type DiffCommit,
    type DiffEntry,
    type DiffLine,
    type DiffScopeKind,
    type DiffSpec,
    type SplitRow,
    type UnifiedRow,
  } from "$lib/diff-view";

  /**
   * **diff 타일 — 읽기 전용** (`kind:"diff"` · docs/log/2026-10-05-diff-tile.md). 브랜치 전체(main 대비) · 커밋 하나 ·
   * 커밋 안 한 변경 셋 중 하나를 고르고, 왼쪽 파일 목록에서 고른 파일 하나의 diff 를 오른쪽에 그린다. 스테이징 · 커밋 ·
   * 편집은 없다(풀 git GUI 를 만들지 않는다).
   *
   * - 폭 [`SPLIT_MIN_WIDTH`] 이상에서만 [나란히] 를 고를 수 있다(고른 보기는 명세에 — 타일마다 기억). 좁은 모드(720px 미만,
   *   브랜치 타일과 같은 경계)에서는 파일 목록이 드롭다운으로 접히고 옛 줄 번호 칸이 빠진다(지운 줄은 옛 번호).
   * - `[` · `]` = 이전 · 다음 파일 — 이 타일 안에서만(`ev.code` · IME 조합 중이면 무시 · 입력 칸이면 무시).
   * - 큰 파일: 줄을 [`chunks`] 로 잘라 덩어리마다 `content-visibility: auto`, 처음 몇 덩어리만 그리고 나머지는 프레임마다
   *   몇 개씩 더한다 — 5천 줄 diff 에서도 첫 그림이 막히지 않는다. 문법 강조는 v1 에 없다(모노 글자만).
   * - 읽는 때: 뜰 때 · 범위를 바꿀 때 · ↻ · 파일을 고를 때. 원격 호스트에 붙은 타일이 없다가 생기면 그때 한 번.
   *
   * 뿌리가 `[data-tile-focus]` 라 `Alt+화살표`로 들어오면 포커스가 온다.
   *
   * ## 줄 코멘트 → AI 타일 (2단계)
   *
   * 줄 번호를 누르면 한 줄, Shift+클릭 · 끌기로 여러 줄을 고른다(한 줄 보기 차례 — 나란히에서는 오른쪽(새 판) 줄, 지운 줄은
   * 왼쪽의 옛 번호). `C`(이 타일 안 · `ev.code` · IME 조합 중 · 입력 칸이면 무시) 또는 "+ 코멘트" 로 범위 아래에 입력 칸이
   * 열리고 Ctrl+Enter 추가 · Esc 취소. 코멘트는 범위 아래 카드 · 파일 목록 배지 · 아래 트레이의 칩으로 보이고, **타일
   * 메모리에만** 산다(명세 · 배치 파일 · 디스크에 싣지 않는다 — 타일을 닫으면 사라진다). 트레이의 "AI 타일에 넘기기" 와
   * 블록 → AI 타일의 단축키(`ask-ai-block` — 같은 id, 이 타일에 포커스가 있을 때)가 넘기지 않은 코멘트를 한 덩어리 글로
   * **붙여 넣기만** 한다(괄호 붙여넣기 · Enter 없음 — `app/ask-ai` 의 같은 몸통). 받을 곳은 같은 워크트리의 AI 타일이 먼저
   * 골라져 있고, AI 타일이 없으면 [복사] 만 남는다. 넘긴 코멘트는 "넘김" 으로 흐려지고 [비우기] 로 지운다.
   *
   * ## 패치 안 찾기 (2026-10-19)
   *
   * 앱의 `find` 키(`Ctrl+F` · 팔레트 — `app/tile-find.ts`)가 파일 머리 아래에 찾기 띠(`DomFindBar` — 문서 타일과 같은 띠 · 같은 규칙)를
   * 연다. 펼친 파일의 줄 글자(덩어리 머리 `@@` 포함)를 찾아 칠하고 지금 일치를 보이게 민다 — 줄 번호(단추) · `+`/`-` 표 · 줄 코멘트 ·
   * 입력 칸은 훑지 않는다(`data-find-skip`). 큰 파일은 덩어리가 프레임마다 더 그려지므로 그때마다 다시 찾는다(셈이 따라 는다). 다른
   * 파일 · 보기로 바꾸면 그 패치에서 다시 찾는다. `Enter` · `F3` 다음 · `Shift+Enter` · `Shift+F3` 이전 · `Esc` 닫고 타일로. 그린 패치가
   * 없으면(파일 없음 · 읽는 중 · 이진) 이 타일의 찾기는 없다(`false` — 모든 터미널 검색).
   *
   * ## 표시 조각 (2026-10-26)
   *
   * 파일 목록 `diff/FilesPane` · 범위 · 보기 줄 `diff/ScopeBar` · 코멘트 입력 칸 `diff/CommentComposer` · 트레이 `diff/CommentTray` 는 props · 콜백만
   * 받는다 — 읽기(요청 세대) · 고른 파일 · 고르개 열림과 패치 본문(점진 렌더링 · 찾기 · 줄 고르기)은 이 파일이 쥔다. 코멘트 · 입력 칸 · 받을 곳 ·
   * 넘기기 상태는 `diff/comments-controller.svelte.ts`(2026-10-27 분할 5차 — 이 파일이 하나 만든다).
   * 패치 본문의 **그림**(줄 · 짝 줄 · 줄 고르기 단추 · "+ 코멘트" · 입력 칸 · 카드)은 `diff/PatchView`(2026-10-27 분할 8차 — 감싸개 없음 · 상태 없음 ·
   * 줄 묶음 `rowsEl` 만 `bind:`) — 덩어리 수 · 줄 고르기 · "+ 코멘트" 재기 · 카드 자리 · 찾기는 여전히 이 파일이다.
   */
  let {
    paneId,
    spec,
  }: {
    paneId: string;
    /** 명세의 주소 — 범위 · 브랜치 · 워크트리 · 커밋 · 파일 · 보기 */
    spec: DiffSpec;
  } = $props();

  const project = $derived(projectById(spec.projectId));

  let read = $state<DiffFilesRead | { state: "loading" }>({ state: "loading" });
  let selected = $state<string | null>(null);
  let fileRead = $state<DiffFileRead | { state: "loading" } | null>(null);
  let width = $state(0);
  let commitMenu = $state(false);
  let fileMenu = $state(false);
  /** 지금 그린 덩어리 수 — 프레임마다 늘린다 */
  let shownChunks = $state(3);
  let bodyEl = $state<HTMLDivElement | null>(null);
  let loadSeq = 0;
  let fileSeq = 0;
  let chunkRaf = 0;

  // ── 2단계 — 줄 코멘트(타일 메모리에만) ──────────────────────────────────────
  /** 고르기의 시작 · 끝 줄 열쇠 */
  let anchorKey = $state<string | null>(null);
  let focusKey = $state<string | null>(null);
  /** 줄 번호를 누른 채 끄는 중 — 그동안은 "+ 코멘트" 줄을 세우지 않는다(줄이 밀려 끄는 손 아래가 바뀌지 않게) */
  let dragging = $state(false);
  let rootEl = $state<HTMLDivElement | null>(null);
  let rowsEl = $state<HTMLDivElement | null>(null);
  /** "+ 코멘트" 의 세로 자리(줄 묶음 기준 px) — 고른 끝 줄을 그린 뒤 잰다 */
  let selbarTop = $state<number | null>(null);
  /** 패치 안 찾기 띠 */
  let finder = $state<ReturnType<typeof DomFindBar> | null>(null);
  /** 파일을 다시 그린 뒤 보이게 할 줄(트레이 칩) */
  let pendingScroll: string | null = null;

  // 코멘트 · 입력 칸 · 받을 곳 · 넘기기는 `diff/comments-controller.svelte.ts`(2026-10-27 분할 5차) — 값은 게터로 넘긴다.
  // 줄 고르기(시작 · 끝 줄 · 끄는 중)와 카드 · 입력 칸의 자리(`cardsAt` · `composerAt`)는 여기에 남는다.
  const cm = createDiffComments({
    get paneId() {
      return paneId;
    },
    get spec() {
      return spec;
    },
    get project() {
      return project;
    },
    get files() {
      return files;
    },
    get branch() {
      return branch;
    },
    get worktree() {
      return worktree;
    },
    get current() {
      return current;
    },
    get here() {
      return here;
    },
    get selKeys() {
      return selKeys;
    },
    get allLines() {
      return allLines;
    },
    get rootEl() {
      return rootEl;
    },
    clearSelection() {
      anchorKey = null;
      focusKey = null;
    },
  });

  const files = $derived(read.state === "ok" ? read.files : null);
  const entries = $derived(files?.files ?? []);
  const current = $derived(entries.find((e) => entryKey(e) === selected) ?? null);
  const index = $derived(current ? entries.indexOf(current) : -1);
  const narrow = $derived(isNarrow(width));
  const splitOk = $derived(canSplit(width));
  const view = $derived(effectiveView(spec.view, width));
  const file = $derived(fileRead?.state === "ok" ? fileRead.file : null);
  const uRows = $derived<UnifiedRow[]>(file && view === "unified" ? unifiedRows(file) : []);
  const sRows = $derived<SplitRow[]>(file && view === "split" ? splitRows(file) : []);
  const uChunks = $derived(chunks(uRows));
  const sChunks = $derived(chunks(sRows));
  const totalChunks = $derived(view === "split" ? sChunks.length : uChunks.length);
  const committed = $derived(entries.filter((e) => e.group === "committed"));
  const uncommitted = $derived(entries.filter((e) => e.group === "uncommitted"));
  const total = $derived(entriesTotal(entries));
  /** 브랜치 — 명세 또는 답에서 배운 것 */
  const branch = $derived(spec.branch ?? files?.branch ?? null);
  /** 커밋 안 한 것을 읽을 워크트리 — 답이 안 것 또는 명세 */
  const worktree = $derived(files?.worktree ?? spec.worktreePath ?? null);
  const docWhy = $derived(docBlock(current, worktree));
  const docWhyText = $derived(
    docWhy === "noWorktree"
      ? t("app.diff.doc.noWorktree")
      : docWhy === "deleted"
        ? t("app.diff.doc.deleted")
        : docWhy === "noFile"
          ? t("app.diff.doc.noFile")
          : null,
  );
  const pickedCommit = $derived(
    spec.scope === "commit" ? (files?.commits.find((c) => spec.commit && c.hash.startsWith(spec.commit)) ?? null) : null,
  );

  const allLines = $derived(file ? file.hunks.flatMap((h) => h.lines) : []);
  /** 지금 보는 파일의 자리 — 범위 · 커밋 · 묶음(코멘트의 배지 · 카드를 이 자리로 가른다) */
  /** 코멘트 자리의 커밋 — `commit` 범위는 그 커밋, `range`(보고) 범위는 끝 커밋 */
  const scopeCommit = $derived(spec.scope === "commit" ? (spec.commit ?? null) : spec.scope === "range" ? (spec.tip ?? null) : null);
  const here = $derived<DiffCommentWhere | null>(
    current ? { scope: spec.scope, commit: scopeCommit, group: current.group } : null,
  );
  /** 파일 목록 한 줄의 자리 */
  const entryWhere = (e: DiffEntry): DiffCommentWhere => ({
    scope: spec.scope,
    commit: scopeCommit,
    group: e.group,
  });
  const selKeys = $derived(anchorKey && focusKey ? selectionKeys(allLines, anchorKey, focusKey) : []);
  const selSet = $derived(new Set(selKeys));
  const selEnd = $derived(selKeys.length > 0 ? selKeys[selKeys.length - 1] : null);
  /** 나란히 보기 — 줄 열쇠 → 그 줄이 든 짝 줄의 열쇠(카드 · 입력 칸 자리) */
  const pairOf = $derived.by(() => {
    const m = new Map<string, string>();
    for (const r of sRows) {
      if (r.type !== "pair") continue;
      if (r.left) m.set(lineKey(r.left), r.key);
      if (r.right) m.set(lineKey(r.right), r.key);
    }
    return m;
  });
  /** 줄(한 줄 보기) 또는 짝 줄(나란히)의 열쇠로 — 그 아래에 서는 것의 자리 */
  const slotOf = (key: string | null): string | null => (key === null ? null : view === "split" ? (pairOf.get(key) ?? null) : key);
  /** 자리 → 그 아래 카드들(지금 파일의 코멘트만) */
  const cardsAt = $derived.by(() => {
    const m = new Map<string, { c: DiffComment; n: number }[]>();
    cm.comments.forEach((c, i) => {
      if (!current || !here || !commentBelongs(c, here, current.path) || c.keys.length === 0) return;
      const at = slotOf(c.keys[c.keys.length - 1]);
      if (at) m.set(at, [...(m.get(at) ?? []), { c, n: i + 1 }]);
    });
    return m;
  });
  const composerAt = $derived(
    cm.composer && current && here && commentEntryKey(cm.composer, cm.composer.path) === commentEntryKey(here, current.path)
      ? slotOf(cm.composer.keys[cm.composer.keys.length - 1] ?? null)
      : null,
  );
  const selbarAt = $derived(cm.composer || dragging ? null : slotOf(selEnd));
  const askCombo = $derived(effectiveCombo("ask-ai-block", settings.current.keybindings));

  /** 다시 읽어야 하는 열쇠 — 범위를 정하는 칸만(커밋 · 워크트리 범위의 브랜치는 고르개 재료일 뿐이라 빼었다) */
  const scopeKey = $derived(
    spec.scope === "branch"
      ? `b:${spec.branch ?? ""}`
      : spec.scope === "commit"
        ? `c:${spec.commit ?? ""}`
        : spec.scope === "range"
          ? `r:${spec.base ?? ""}:${spec.tip ?? ""}`
          : `w:${spec.worktreePath ?? ""}`,
  );

  async function load(): Promise<void> {
    const p = project;
    if (!p) return;
    const mine = ++loadSeq;
    if (read.state !== "ok") read = { state: "loading" };
    const r = await readDiffFiles(p, spec);
    if (mine !== loadSeq) return;
    read = r;
    if (r.state !== "ok") {
      fileRead = null;
      return;
    }
    // 답에서 배운 브랜치 · 워크트리를 명세에 — 범위를 바꿀 때 쓴다(다시 읽는 열쇠에는 들지 않는다).
    const learn: Partial<DiffSpec> = {};
    if (!spec.branch && r.files.branch) learn.branch = r.files.branch;
    if (!spec.worktreePath && r.files.worktree) learn.worktreePath = r.files.worktree;
    if (Object.keys(learn).length > 0) noteDiff(paneId, learn);
    const keep = selected ? r.files.files.find((e) => entryKey(e) === selected) : undefined;
    const pick = keep ?? pickEntry(r.files.files, spec.file, spec.scope === "wip" ? "uncommitted" : undefined);
    select(pick, false);
  }

  /** 파일을 고른다 — 명세에 적고(배치에 실린다) 그 파일의 diff 를 읽는다 */
  function select(entry: DiffEntry | null, note = true): void {
    selected = entry ? entryKey(entry) : null;
    anchorKey = null;
    focusKey = null;
    if (!entry) {
      fileRead = null;
      return;
    }
    if (note && spec.file !== entry.path) noteDiff(paneId, { file: entry.path });
    void loadFile(entry);
  }

  async function loadFile(entry: DiffEntry): Promise<void> {
    const p = project;
    if (!p) return;
    const mine = ++fileSeq;
    fileRead = { state: "loading" };
    const r = await readDiffFile(p, spec, entry);
    if (mine !== fileSeq) return;
    fileRead = r;
    resetChunks();
    await tick();
    if (bodyEl) bodyEl.scrollTop = 0;
    if (pendingScroll) {
      const key = pendingScroll;
      pendingScroll = null;
      void scrollToRow(key);
    }
  }

  /** 덩어리를 처음 몇 개로 되돌리고 프레임마다 더한다 */
  function resetChunks(): void {
    cancelAnimationFrame(chunkRaf);
    shownChunks = 3;
    const step = () => {
      if (shownChunks >= totalChunks) return;
      shownChunks += 4;
      chunkRaf = requestAnimationFrame(step);
    };
    chunkRaf = requestAnimationFrame(step);
  }

  // 뜰 때 · 범위가 바뀔 때 한 번 — 화면용 이름(프로젝트)도 명세에 적는다.
  $effect(() => {
    const p = project;
    void scopeKey;
    if (!p) return;
    untrack(() => {
      if (spec.name !== p.name && !spec.branch) noteDiff(paneId, { name: p.name });
      selected = null;
      fileRead = null;
      read = { state: "loading" };
      void load();
    });
  });

  // 다른 입구가 같은 타일의 파일을 바꾸면(같은 범위) 그 파일을 고른다.
  $effect(() => {
    const want = spec.file;
    untrack(() => {
      if (!want || current?.path === want || read.state !== "ok") return;
      const hit = pickEntry(entries, want, spec.scope === "wip" ? "uncommitted" : undefined);
      if (hit && hit.path === want) select(hit, false);
    });
  });

  // 원격 — 붙은 타일이 없어 못 읽었는데 이제 생겼다면 한 번 읽는다(시계 없음: 세션 표가 반응형이다).
  $effect(() => {
    const p = project;
    if (!p || read.state !== "offline" || !isRemote(p)) return;
    if (liveSessionFor(p.host) !== null) untrack(() => void load());
  });

  $effect(() => () => cancelAnimationFrame(chunkRaf));

  // "+ 코멘트" 의 자리 — 고른 끝 줄(또는 그 짝 줄)의 아래 가장자리. 보기 · 덩어리 · 카드가 바뀌면 다시 잰다.
  $effect(() => {
    const slot = selbarAt;
    void shownChunks;
    void cardsAt;
    const box = rowsEl;
    if (!slot || !box) {
      selbarTop = null;
      return;
    }
    void tick().then(() => {
      const row = box.querySelector<HTMLElement>(`[data-diff-row="${CSS.escape(slot)}"]`);
      selbarTop = row ? row.getBoundingClientRect().bottom - box.getBoundingClientRect().top - 2 : null;
    });
  });

  // [새로 고침] 아이콘 — 읽는 동안 돌고, 빨리 끝나도 한 바퀴는 채운 뒤 바퀴 끝에서 멈춘다(브랜치 타일과 같은 규칙 · `onanimationiteration`)
  let refreshing = $state(false);
  let spinning = $state(false);

  async function refresh(): Promise<void> {
    refreshing = true;
    spinning = true;
    try {
      await load();
    } finally {
      refreshing = false;
    }
  }

  /** `find` 액션의 이 타일 몫 — 그린 패치가 있을 때만 띠를 연다 */
  function openFind(): boolean {
    if (!rowsEl) return false;
    return finder?.show() ?? false;
  }

  // `find` 액션의 문 — 제 타일 id 로 적는다
  $effect(() => {
    const id = paneId;
    return untrack(() => registerTileFind(id, openFind));
  });

  // ── 범위 · 보기 ────────────────────────────────────────────────────────────

  function setScope(scope: DiffScopeKind, extra: Partial<DiffSpec> = {}): void {
    commitMenu = false;
    noteDiff(paneId, { scope, ...extra });
  }

  function pickCommit(c: DiffCommit): void {
    setScope("commit", { commit: c.hash, file: undefined });
  }

  function setView(v: "unified" | "split"): void {
    if (v === "split" && !splitOk) return;
    noteDiff(paneId, { view: v === "split" ? "split" : undefined });
    resetChunks();
  }

  function step(dir: -1 | 1): void {
    const next = stepEntry(entries, selected, dir);
    if (next && entryKey(next) !== selected) select(next);
  }

  function openDoc(): void {
    const p = project;
    if (!p || !current || !worktree || docWhy) return;
    openDiffDoc(paneId, p, worktree, current.path);
  }

  /**
   * 이 타일의 키 — `[` · `]`(파일 걸음) · `C`(고른 줄에 코멘트) · Esc(고르개 · 고르기 걷기), 그리고 블록 → AI 타일의
   * 단축키(`ask-ai-block` — 터미널 층 조합이라 전역 표에 없다: 포커스가 이 타일에 있으면 여기서 코멘트를 넘긴다).
   * 입력 칸 · IME 조합 중 · 수식 키가 있으면 맨 키는 비켜 선다(`ev.code` 로만 본다).
   */
  function onKey(ev: KeyboardEvent): void {
    if (ev.isComposing || ev.keyCode === 229) return;
    const combo = comboFromEvent(ev);
    if (askCombo && combo === askCombo) {
      ev.preventDefault();
      ev.stopPropagation();
      void cm.handOver();
      return;
    }
    if (ev.ctrlKey || ev.altKey || ev.metaKey || ev.shiftKey) return;
    if (isEditableTarget(ev.target)) return;
    if (ev.code === "BracketLeft" || ev.code === "BracketRight") {
      ev.preventDefault();
      step(ev.code === "BracketLeft" ? -1 : 1);
    } else if (ev.code === "KeyC" && selKeys.length > 0 && !cm.composer) {
      ev.preventDefault();
      cm.openComposer();
    } else if (ev.code === "Escape" && (commitMenu || fileMenu || cm.targetMenu)) {
      ev.preventDefault();
      commitMenu = false;
      fileMenu = false;
      cm.targetMenu = false;
    } else if (ev.code === "Escape" && selKeys.length > 0) {
      ev.preventDefault();
      anchorKey = null;
      focusKey = null;
    }
  }

  // ── 줄 고르기 · 코멘트 ──────────────────────────────────────────────────────

  /** 줄 번호 누름 — 한 줄(Shift 면 시작 줄에서 여기까지), 누른 채 끌면 늘린다 */
  function onNoDown(ev: PointerEvent, key: string): void {
    if (ev.button !== 0) return;
    ev.preventDefault(); // 글자 긁기 대신 줄 고르기
    if (ev.shiftKey && anchorKey) focusKey = key;
    else {
      anchorKey = key;
      focusKey = key;
    }
    dragging = true;
    // 같은 함수 하나라 거듭 눌러도 한 벌만 붙고, 놓기 전에 타일이 닫혀도 아래 정리가 걷는다
    window.addEventListener("pointerup", endNoDrag, { once: true });
    rootEl?.focus({ preventScroll: true });
  }

  /** 줄 번호 끌기 끝 — 창 `pointerup` 한 번 */
  function endNoDrag(): void {
    dragging = false;
  }

  // 놓기 전에 언마운트되면(타일 닫기 · 탭 이동) 창에 남은 리스너를 걷는다
  $effect(() => () => window.removeEventListener("pointerup", endNoDrag));

  function onNoEnter(key: string): void {
    if (dragging) focusKey = key;
  }

  /**
   * 트레이 칩 — 그 코멘트의 자리(범위 · 묶음 · 파일)로 가서 그 줄이 보이게. 범위가 다르면 범위부터 바꾼다(다시 읽은 뒤 그 파일을
   * 고르고, 줄까지는 따라가지 않는다).
   */
  function jumpTo(c: DiffComment): void {
    const key = c.keys[c.keys.length - 1];
    const sameScope = c.scope === spec.scope && (c.scope !== "commit" && c.scope !== "range" ? true : c.commit === scopeCommit);
    if (!sameScope) {
      const at = c.commit ? (c.scope === "range" ? { tip: c.commit } : { commit: c.commit }) : {};
      setScope(c.scope, { ...at, file: c.path });
      return;
    }
    if (current && here && commentBelongs(c, here, current.path)) {
      if (key) void scrollToRow(key);
      return;
    }
    const e = entries.find((x) => x.path === c.path && x.group === c.group);
    if (!e) return;
    pendingScroll = key ?? null;
    select(e);
  }

  async function scrollToRow(key: string): Promise<void> {
    const slot = slotOf(key);
    if (!slot) return;
    const rows: { key: string }[] = view === "split" ? sRows : uRows;
    const at = rows.findIndex((r) => r.key === slot);
    if (at >= 0) shownChunks = Math.max(shownChunks, Math.ceil((at + 1) / ROW_CHUNK) + 1);
    await tick();
    const el = bodyEl?.querySelector<HTMLElement>(`[data-diff-row="${CSS.escape(slot)}"]`);
    if (el && bodyEl) bodyEl.scrollTop = Math.max(0, el.offsetTop - bodyEl.clientHeight / 3);
  }

  /** 열린 고르개를 바깥 클릭으로 닫는다 */
  function onRootPointer(ev: PointerEvent): void {
    const el = ev.target as HTMLElement | null;
    if (commitMenu && !el?.closest("[data-diff-commit-menu], [data-diff-scope-btn='commit']")) commitMenu = false;
    if (fileMenu && !el?.closest("[data-diff-file-menu], [data-diff-narrow-picker]")) fileMenu = false;
    if (cm.targetMenu && !el?.closest("[data-diff-target-menu], [data-diff-target]")) cm.targetMenu = false;
  }

  const closeCommitMenu = () => (commitMenu = false);
  const closeFileMenu = () => (fileMenu = false);

  // ── 그리기 도우미 ──────────────────────────────────────────────────────────

  function scopeLabelCommit(): string {
    if (spec.scope === "commit" && spec.commit) {
      const subject = pickedCommit?.subject ?? "";
      return subject
        ? t("app.diff.scope.commitPicked", { hash: shortHash(spec.commit), subject })
        : shortHash(spec.commit);
    }
    return t("app.diff.scope.commit");
  }

  const now = $derived.by(() => {
    void read;
    return Date.now();
  });

  const noOf = (l: DiffLine): number | null => l.newNo ?? l.oldNo;
  // 타일 제목줄 개편(2026-10-20) — 머리줄이 서 있으면 이 도구줄이 머리줄 가운데로 올라가 한 줄이 된다(`pane/pane-tools.svelte.ts`).
  // 머리줄이 없으면(설정 `tile_header` · 폰) 예전처럼 몸 맨 위에 그린다. 스니펫이라 어디에 그려지든 이 화면의 상태 · 단축키가 그대로다.
  const inHead = $derived(!!paneId && paneHeadShown(paneId));
  $effect(() => {
    const id = paneId;
    if (!id) return;
    return setPaneTools(id, { bar: diffBar, nameTip: () => t("app.diff.readOnly") });
  });
</script>

{#snippet counts(a: number | null, d: number | null, binary: boolean)}
  {#if binary}
    <span class="n">{t("app.diff.files.binary")}</span>
  {:else if a !== null || d !== null}
    <span class="n"
      >{#if (a ?? 0) > 0}<span class="plus">+{a}</span>{/if}{#if (a ?? 0) > 0 && (d ?? 0) > 0}{" "}{/if}{#if (d ?? 0) > 0}<span
          class="minus">−{d}</span
        >{/if}</span
    >
  {/if}
{/snippet}

<!-- 도구줄(읽기 전용 칩 · 문서로 열기 · 새로고침) — 머리줄이 서 있으면 머리줄 가운데(`head` = 참)에, 아니면 몸 맨 위에 그린다(위 `inHead` · `pane/pane-tools.svelte.ts`). 범위 · 보기 줄(`.tools`)은 몸에 남는다
     머리줄 안에서 포커스 밖이면 문서로 열기 · 새로고침(`data-head-act`)은 접히고 읽기 전용 칩은 남는다("늘 보임 / 드러날 때만") -->
<!-- 머리줄 안이면 읽기 전용은 이름 말풍선으로(`nameTip`), 두 단추는 그림만(이름은 말풍선 · aria) — 10-20 사용자. 몸 위 줄이면 예전처럼 글자와 함께 -->
{#snippet diffBar(head: boolean)}
    <div class="bar" class:inhead={head}>
      {#if !head}<span class="ro">{t("app.diff.readOnly")}</span>{/if}
      <span class="sp"></span>
      <button
        type="button"
        class="btn"
        data-head-act
        disabled={docWhy !== null}
        title={docWhyText ?? t("app.diff.openDoc.title")}
        aria-label={t("app.diff.openDoc")}
        data-diff-doc
        onclick={openDoc}
        ><UiIcon name="file-text" size={13} />{#if !head}<span class="label">{t("app.diff.openDoc")}</span>{/if}</button
      >
      <button
        type="button"
        class="btn refresh"
        class:spinning
        data-head-act
        title={t("app.diff.refresh")}
        aria-label={t("app.diff.refresh")}
        aria-busy={refreshing}
        data-diff-refresh
        onclick={() => void refresh()}
        onanimationiteration={() => {
          if (!refreshing) spinning = false;
        }}
        ><UiIcon name="refresh" size={13} />{#if !head}<span class="label">{t("app.diff.refresh")}</span>{/if}</button
      >
    </div>
{/snippet}

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="diff"
  role="presentation"
  tabindex="-1"
  data-tile-focus
  data-diff-pane={paneId}
  data-diff-scope={spec.scope}
  data-diff-view={view}
  data-diff-narrow={narrow ? "" : undefined}
  bind:clientWidth={width}
  bind:this={rootEl}
  onkeydown={onKey}
  onpointerdown={onRootPointer}
>
  <!-- 아이콘 · "변경 · <브랜치>" 는 타일 머리줄(`PaneIcon` · `paneName`)이 그린다 — 여기는 칩과 단추만(브랜치 타일과 같다) -->
  {#if !inHead}{@render diffBar(false)}{/if}

  {#if !project}
    <p class="note" data-diff-note="noProject">{t("app.diff.noProject")}</p>
  {:else}
    <ScopeBar
      {spec}
      {files}
      {branch}
      {worktree}
      {entries}
      {total}
      {view}
      {splitOk}
      {narrow}
      {current}
      {index}
      {selected}
      {now}
      bind:commitMenu
      bind:fileMenu
      {setScope}
      {pickCommit}
      {setView}
      {select}
      {scopeLabelCommit}
      {closeCommitMenu}
      {closeFileMenu}
      {counts}
    />

    {#if read.state === "loading"}
      <p class="note" data-diff-note="loading">{t("app.diff.loading")}</p>
    {:else if read.state === "offline"}
      <p class="note" data-diff-note="offline">{t("app.diff.offline", { host: project.host ?? "" })}</p>
    {:else if read.state === "notRepo"}
      <p class="note" data-diff-note="notRepo">{t("app.diff.notRepo")}</p>
    {:else if read.state === "noScope"}
      <p class="note" data-diff-note="noScope">{t("app.diff.noScope")}</p>
    {:else if read.state === "error"}
      <p class="note err" data-diff-note="error" title={read.message}>{read.message}</p>
    {:else if files && files.merge}
      <p class="note" data-diff-note="merge">{t("app.diff.merge")}</p>
    {:else if files}
      <div class="body" class:narrow>
        {#if !narrow}
          <div class="lcol"><FilesPane {files} {entries} {committed} {uncommitted} {selected} commentCount={cm.commentCount} {entryWhere} {select} {counts} /></div>
        {/if}
        <div class="rcol">
          {#if current}
            {@const sp = splitPath(current.path)}
            <div class="fhead" data-diff-file-head={current.path}>
              <span class="path" title={current.path}><span class="dir">{sp.dir}</span>{sp.name}</span>
              {#if file}{@render counts(file.added, file.deleted, file.binary)}{/if}
              <span class="sp"></span>
              {#if !narrow && file && file.hunks.length > 0}<span class="fhint">{t("app.diff.file.hint")}</span>{/if}
              <button type="button" class="nav" disabled={index <= 0} title={t("app.diff.file.prev")} aria-label={t("app.diff.file.prev")} data-diff-prev onclick={() => step(-1)}>◀</button>
              <span class="pos">{index + 1}/{entries.length}</span>
              <button
                type="button"
                class="nav"
                disabled={index >= entries.length - 1}
                title={t("app.diff.file.next")}
                aria-label={t("app.diff.file.next")}
                data-diff-next
                onclick={() => step(1)}>▶</button
              >
            </div>
          {/if}
          <DomFindBar
            bind:this={finder}
            root={rowsEl}
            scroller={() => bodyEl}
            label={t("app.diff.find")}
            onclose={() => rootEl?.focus({ preventScroll: true })}
          />
          <div class="dbody" bind:this={bodyEl} role="region" aria-label={t("app.diff.body.aria")} data-diff-body>
            {#if !current}
              <p class="note">{t("app.diff.files.none")}</p>
            {:else if fileRead === null || fileRead.state === "loading"}
              <p class="note" data-diff-note="fileLoading">{t("app.diff.file.loading")}</p>
            {:else if fileRead.state === "offline"}
              <p class="note">{t("app.diff.offline", { host: project.host ?? "" })}</p>
            {:else if fileRead.state === "error"}
              <p class="note err" title={fileRead.message}>{fileRead.message}</p>
            {:else if file}
              {#if file.binary}
                <p class="note" data-diff-note="binary">{t("app.diff.file.binary")}</p>
              {:else if file.hunks.length === 0 && file.truncated}
                <p class="note" data-diff-note="tooLarge">
                  {t("app.diff.file.tooLarge")}
                  {#if !docWhy}<button type="button" class="link" onclick={openDoc}>{t("app.diff.openDoc")}</button>{/if}
                </p>
              {:else if file.hunks.length === 0}
                <p class="note" data-diff-note="empty">{t("app.diff.file.empty")}</p>
              {:else}
                <PatchView
                  {paneId}
                  {view}
                  {narrow}
                  {uChunks}
                  {sChunks}
                  {shownChunks}
                  {selSet}
                  {selbarAt}
                  {selbarTop}
                  {cardsAt}
                  {composerAt}
                  {cm}
                  {noOf}
                  {onNoDown}
                  {onNoEnter}
                  bind:rowsEl
                />
                {#if file.truncated}
                  <p class="note trunc" data-diff-note="truncated">
                    {t("app.diff.file.truncated")}
                    {#if !docWhy}<button type="button" class="link" onclick={openDoc}>{t("app.diff.openDoc")}</button>{/if}
                  </p>
                {/if}
              {/if}
            {/if}
          </div>
        </div>
      </div>
    {/if}
    {#if cm.comments.length > 0 || cm.composer}
      <!--
        코멘트 트레이 (2단계) — 칩 · 받을 곳 · 넘기기. 붙여 넣기만 하고 Enter 는 사람이 누른다. AI 타일이 없으면 [복사] 만.
      -->
      <CommentTray
        comments={cm.comments}
        composer={cm.composer}
        targets={cm.targets}
        target={cm.target}
        unsent={cm.unsent}
        {askCombo}
        bind:targetMenu={cm.targetMenu}
        {jumpTo}
        clearSent={cm.clearSent}
        closeTargetMenu={cm.closeTargetMenu}
        pickTarget={cm.pickTarget}
        handOver={cm.handOver}
      />
    {/if}
  {/if}
</div>

<style>
  .diff {
    container: diff / inline-size;
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    /* 글래스 크롬 타일이면 판(흐림 + `--glass-mid`)은 타일 상자가 한 번 칠한다 — 여기는 `--tile-inner`(투명 · `PaneHost`) */
    background: var(--tile-inner, var(--bg-panel));
    color: var(--fg);
    font-family: var(--font-ui);
    /* 더함 · 뺌 — 그래프 · 배지와 같은 초록 · 빨강(토큰이라 라이트/다크를 따라간다) */
    --plus-fg: color-mix(in srgb, var(--ok) 70%, var(--fg-3));
    --minus-fg: color-mix(in srgb, var(--err) 70%, var(--fg-3));
    --plus-bg: color-mix(in srgb, var(--ok) 14%, transparent);
    --minus-bg: color-mix(in srgb, var(--err) 14%, transparent);
    --row-h: 20px;
  }

  .diff:focus {
    outline: none;
  }

  .bar {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 0 0 auto;
    padding: 5px 8px;
    border-bottom: 1px solid var(--border);
    font-size: 11px;
    color: var(--fg-2);
  }

  /* 머리줄 안(2026-10-20) — 머리줄 가운데 칸을 채우고 선 · 여백이 없다 */
  .bar.inhead {
    flex: 1 1 0;
    min-width: 0;
    padding: 0 0 0 4px;
    border-bottom: none;
    /* 줄의 gap(전역 `.bar` — `BrowserToolbar`) — 포커스 밖에서 접히는 조작 단추(`data-head-act`)의 앞 간격을 지운다(`pane/pane-tools.svelte.ts`) */
    --head-act-gap: 4px;
  }

  .ro {
    padding: 0 7px;
    border-radius: 999px;
    background: var(--bg-chip);
    color: var(--fg-chip);
    white-space: nowrap;
  }

  .sp {
    flex: 1 1 auto;
  }

  .btn {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 3px 7px;
    font-family: var(--font-ui);
    font-size: 11px;
    line-height: 1.4;
    color: var(--fg-muted);
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--radius);
    cursor: pointer;
  }

  .btn:hover:not(:disabled) {
    color: var(--fg);
    background: var(--bg-hover);
  }

  .btn:disabled {
    opacity: 0.45;
    cursor: default;
  }

  .btn:focus-visible,
  .nav:focus-visible,
  .link:focus-visible {
    outline: 1px solid var(--accent);
    outline-offset: -1px;
  }

  @container diff (max-width: 520px) {
    .btn .label {
      display: none;
    }
  }

  .btn.refresh.spinning :global(svg) {
    animation: diff-spin 0.9s linear infinite;
  }

  @keyframes diff-spin {
    to {
      transform: rotate(360deg);
    }
  }

  /* 움직임을 줄여 달라고 했으면 돌리지 않고 읽는 동안 흐리게만(브랜치 타일과 같은 처방 — 흐림은 `aria-busy` 를 따른다) */
  @media (prefers-reduced-motion: reduce) {
    .btn.refresh.spinning :global(svg) {
      animation: none;
    }
    .btn.refresh[aria-busy="true"] :global(svg) {
      opacity: 0.5;
    }
  }

  .plus {
    color: var(--plus-fg);
    font-family: var(--font-mono);
  }

  .minus {
    color: var(--minus-fg);
    font-family: var(--font-mono);
  }

  .note {
    margin: 0;
    padding: 24px 16px;
    text-align: center;
    font-size: 12px;
    color: var(--fg-3);
  }

  .note.err {
    color: var(--err);
  }

  .note.trunc {
    padding: 10px 16px;
    border-top: 1px dashed var(--border);
  }

  .link {
    border: 0;
    background: transparent;
    color: var(--accent);
    font: inherit;
    cursor: pointer;
    text-decoration: underline;
  }

  .body {
    flex: 1 1 auto;
    min-height: 0;
    display: grid;
    grid-template-columns: 270px minmax(0, 1fr);
  }

  .body.narrow {
    grid-template-columns: minmax(0, 1fr);
  }

  .lcol {
    min-height: 0;
    overflow: auto;
    border-right: 1px solid var(--border);
  }

  .path {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-mono);
    font-size: 11.5px;
  }

  .dir {
    color: var(--fg-3);
  }

  .n {
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: var(--fg-3);
    white-space: nowrap;
  }

  .rcol {
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  .fhead {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 0 0 auto;
    padding: 5px 10px;
    border-bottom: 1px solid var(--border);
    background: var(--surface-raised);
    font-size: 11.5px;
  }

  .fhead .path {
    font-size: 12px;
  }

  .fhead .pos {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--fg-3);
  }

  .nav {
    padding: 1px 6px;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--fg-2);
    font-size: 10px;
    cursor: pointer;
  }

  .nav:hover:not(:disabled) {
    background: var(--bg-hover);
    color: var(--fg);
  }

  .nav:disabled {
    opacity: 0.35;
    cursor: default;
  }

  /* diff 본문 — 이 칸 안에서 세로 · 가로 스크롤(한 줄 보기의 긴 줄은 가로로) */
  .dbody {
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
    font-family: var(--font-mono);
    font-size: 12px;
  }

  .fhint {
    font-size: 11px;
    color: var(--fg-3);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }
</style>
