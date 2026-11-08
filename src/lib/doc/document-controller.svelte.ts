// **문서 타일의 문서 상태** — `DocView.svelte` 에서 그대로 옮긴 컨트롤러(2026-10-27 분할 9차).
// `DocView` 가 하나 만들고(`createDocDocument` — 경로 · 백엔드 · 끊김 · 원본 없음 · 미리 보기 표식 · 편집기 · 뿌리 상자는 게터로) 값은 게터로 읽는다.
//
// 쥐는 것: 마지막으로 읽은 파일 · 읽는 중 · 오류 · 읽기 차례(`seq`) · 도장(`stamp`) · 자동 새로고침 박자(`poll` — 묻고, 바뀌었으면 읽고, 다르면
// 들인다 `accept`) · 편집 중인가 · 더러움 · 저장(`save` — 기대 version · [덮어쓰기]) · "저장됨" 반짝임 · 편집 띠(충돌 · 디스크 바뀜 · 저장 못 함 —
// 전이는 순수 `doc-edit.ts`) · 다시 불러오기 · 편집 때문에 고정했는가 · 읽기 보기 체크박스 쓰기(차례로) · 외부로 열기 · 외부 편집기.
//
// **편집 미리 보기의 한때 값(미리 보기 글 · 좁은 타일 탭 · 커서 줄 · 편집기 화면 범위 · 미리 보기 타이머)은 `DocView` 에 남는다** — 편집 시작 ·
// 다시 불러오기 · 편집 종료가 그 값을 만지던 자리는 같은 순서로 `onEditStart` · `onEditReload` · `stopPreviewTimer` 를 부른다.
// **`$effect` · 타이머 등록 · 등록 표(`app/doc-dirty`)는 여기 없다** — 경로 · 원본이 바뀌면 다시 읽기, 박자 `setInterval`, 더러움 표 ·
// 저장 함수 등록, 언마운트 정리(`dispose` — "저장됨" 타이머)는 `DocView` 의 원래 자리 · 원래 순서 그대로다.
import { tick } from "svelte";
import type { FsBackend, TextFile } from "$lib/fs-backend";
import { replacePlan, shouldPoll, stampChanged, stuckToBottom, type Stamp } from "$lib/doc-refresh";
import { taskCharOf, taskMarkOf, toggleTaskLine } from "$lib/doc-task";
import {
  NO_BAND,
  bandOnDisk,
  bandOnDismiss,
  bandOnIgnore,
  bandOnSave,
  editBlockOf,
  saveFailureOf,
  type BandState,
  type EditBlock,
} from "$lib/doc-edit";
import { isSessionGone } from "$lib/sftp-browser";
import { stripReason } from "$lib/error-reason";
import { t } from "$lib/i18n/i18n.svelte.js";

/** 저장이 편집기에 묻고 알리는 것 — `DocEditor` 의 두 함수 */
export interface DocSaveEditor {
  getText(): string;
  markSaved(text: string): void;
}

/** `DocView` 가 넘기는 값 — **게터**라 그때그때의 값이다(생성 시점 사본이 아니다). */
export interface DocDocumentHost {
  /** 보여 줄 파일의 절대 경로 */
  readonly path: string;
  readonly backend: FsBackend;
  /** 원본에 닿지 않는다(`!backend.online`) */
  readonly offline: boolean;
  /** 원본 터미널 타일이 아예 없어졌다 */
  readonly sourceGone: boolean;
  /** 미리 보기 문서인가 — 편집하는 동안만 고정한다 */
  readonly preview: boolean;
  /** 편집기(`bind:this`) — 편집 중이 아니면 `null` */
  readonly editor: DocSaveEditor | null;
  /** 타일의 키보드 몸 — 보이는가 · 편집 종료 뒤 포커스 */
  readonly rootEl: HTMLDivElement | null;
  /** 지금 스크롤하는 상자 — 통째로 바꿀 때 스크롤을 지킨다 */
  scroller(): HTMLElement | null;
  /** 프롭 `onkeep` · `onunkeep` · `onnotice` */
  onkeep(): void;
  onunkeep(): void;
  onnotice(message: string): void;
  /** 편집을 시작했다 — 미리 보기 쪽 한때 값을 그 글로(미리 보기 글 · 좁은 타일 탭 · 커서 줄 · 화면 범위) */
  onEditStart(text: string): void;
  /** 다시 불러오기로 편집을 새로 세운다 — 미리 보기 타이머를 멈추고 한때 값을 새 글로 */
  onEditReload(text: string): void;
  /** 미리 보기 타이머 멈춤 */
  stopPreviewTimer(): void;
}

/** 문서 하나를 만든다 — 상태는 이 안에 살고 읽기는 게터로 */
export function createDocDocument(host: DocDocumentHost) {
  /** 마지막으로 읽은 파일 — 끊겨도, 다시 읽다 실패해도 지우지 않는다 */
  let file = $state<TextFile | null>(null);
  let loading = $state(false);
  /** 편집 모드인가 — 몸통이 편집기다 (E1 — 아래 "편집" 묶음) */
  let editing = $state(false);
  let error = $state<string | null>(null);
  /** 늦게 온 답이 새 답을 덮지 않게 — 읽기마다 하나씩 오른다 */
  let seq = 0;

  /** 마지막으로 **읽은 때의** `stat` — 다음 박자가 이것과 견준다. 화면에 나오지 않아 반응형이 아니다 */
  let stamp: Stamp | null = null;
  /** 자동 새로고침의 묻기·읽기가 날아가 있다 — 박자가 겹쳐 보내지 않게 */
  let polling = false;
  /** 글을 마지막으로 들인 때 — 타일 ⋯ 메뉴 맨 아래 정보 줄 */
  let updatedAt = $state<Date | null>(null);

  // ── 편집 (E1) ────────────────────────────────────────────────────────────────

  /** 편집기를 새로 세우는 열쇠 — 다시 불러오기가 올린다(`{#key}`) */
  let editGen = $state(0);
  /** 편집기의 글이 저장해 둔 글과 다르다 */
  let dirty = $state(false);
  /** 저장이 날아가 있다 */
  let saving = $state(false);
  /** 방금 저장했다 — 도구줄의 작은 "저장됨"(토스트 없음). 몇 초 뒤 꺼진다 */
  let savedFlash = $state(false);
  let savedTimer: ReturnType<typeof setTimeout> | null = null;
  /** 편집의 기준 version — 저장의 기대값. 편집 시작 · 저장 · 다시 불러오기 때 옮긴다 */
  let baseVersion = "";
  /** 편집 중 띠(충돌 · 디스크 바뀜 · 저장 못 함) */
  let bands = $state<BandState>(NO_BAND);

  /** 편집을 막는 사정 — 파일이 없으면 `null`(단추가 서지 않는다) */
  const editBlock = $derived<EditBlock | null>(file ? editBlockOf(file) : null);

  /** 편집 때문에 고정했는가 — [편집 종료]에서 미리 보기로 돌려놓는다 */
  let keptForEdit = false;

  function startEdit() {
    if (!file || editBlockOf(file) !== null || !host.backend.canWrite || host.offline) return;
    // 편집하는 동안만 고정한다(다음 파일이 이 칸을 갈아 끼우지 않게). 타일링이라 편집이 끝나면 다시 미리 보기 —
    // 저장했어도 같다. 남겨 둘 문서는 [고정]으로 따로 고정한다
    keptForEdit = host.preview;
    if (host.preview) host.onkeep();
    baseVersion = file.version;
    bands = NO_BAND;
    dirty = false;
    savedFlash = false;
    editGen++;
    host.onEditStart(file.text);
    editing = true;
  }

  /** [되돌리기] · [편집 종료] — 변경을 버리고 읽기 보기로. 편집 중 멈춰 둔 디스크의 새 글을 들인다 */
  function endEdit() {
    editing = false;
    host.stopPreviewTimer();
    if (keptForEdit) host.onunkeep();
    keptForEdit = false;
    dirty = false;
    bands = NO_BAND;
    savedFlash = false;
    host.rootEl?.focus({ preventScroll: true });
    if (host.backend.online) void load();
  }

  /**
   * 저장 — 사람이 누른 저장(`Ctrl+S` · [저장] · 닫기 대화의 [저장하고 닫기])만 여기 온다.
   * `force` 는 충돌 띠의 [덮어쓰기]뿐이다(기대 version 없이 쓴다). 저장할 것이 없으면(편집 중이 아니거나
   * 바뀐 것이 없으면) 참.
   */
  async function save(force = false): Promise<boolean> {
    const editor = host.editor;
    if (!editing || !editor) return true;
    if (!dirty && !force) return true;
    if (saving) return false;
    const backend = host.backend;
    if (host.offline || !backend.writeText) {
      bands = bandOnSave(bands, { ok: false, why: "gone" });
      return false;
    }
    const text = editor.getText();
    saving = true;
    try {
      const res = await backend.writeText(host.path, text, force ? null : baseVersion);
      baseVersion = res.version;
      host.editor?.markSaved(text);
      if (file) {
        file.text = text;
        file.size = res.size;
        file.version = res.version;
        file.truncated = false;
      }
      bands = bandOnSave(bands, { ok: true });
      flashSaved();
      return true;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const outcome = saveFailureOf(message);
      bands = bandOnSave(bands, outcome.ok ? outcome : { ...outcome, message: stripReason(message) });
      return false;
    } finally {
      saving = false;
    }
  }

  function flashSaved() {
    savedFlash = true;
    if (savedTimer) clearTimeout(savedTimer);
    savedTimer = setTimeout(() => (savedFlash = false), 2500);
  }

  /**
   * 띠의 [다시 불러오기] — 내 변경을 버리고 디스크의 지금 글로 편집을 새로 시작한다. 새 글이 편집할 수 없는
   * 것이 됐으면(커졌다 · 이진) 편집을 끝내고 읽기 보기로 보여 준다.
   */
  async function reloadForEdit() {
    if (!host.backend.readText || host.offline) return;
    const my = ++seq;
    loading = true;
    try {
      const st = await stampOf();
      // 백엔드 · 경로는 도장 **뒤의** 지금 값이다(재연결이 끼어도 새 세션으로 읽는다)
      const got = await host.backend.readText(host.path);
      if (my !== seq) return;
      stamp = st;
      file = got;
      updatedAt = new Date();
      error = null;
      bands = NO_BAND;
      dirty = false;
      if (editBlockOf(got) !== null) {
        editing = false;
        return;
      }
      baseVersion = got.version;
      editGen++;
      host.onEditReload(got.text);
    } catch (e) {
      if (my !== seq) return;
      const message = e instanceof Error ? e.message : String(e);
      const outcome = saveFailureOf(message);
      bands = bandOnSave(bands, outcome.ok ? outcome : { ...outcome, message: stripReason(message) });
    } finally {
      if (my === seq) loading = false;
    }
  }

  /** 편집기를 받지 못했다 — 읽기 보기로 남고 오류 띠로 말한다 */
  function editorFailed(message: string) {
    editing = false;
    dirty = false;
    error = t("files.doc.editor.failed", { message });
  }

  /** 언마운트 — "저장됨" 타이머를 거둔다 */
  function dispose() {
    if (savedTimer) clearTimeout(savedTimer);
  }

  // ── 체크박스 ─────────────────────────────────────────────────────────────────

  /** 읽기 보기에서 쓰는 중인 체크박스 줄들 — 그동안 그 체크박스는 막힌다 */
  let taskBusy = $state<ReadonlySet<number>>(new Set());
  /** 체크박스 쓰기를 차례로 — 앞 쓰기가 옮긴 `version` 이 다음 쓰기의 기대값이다 */
  let taskChain: Promise<void> = Promise.resolve();

  /** 읽기 보기의 체크박스를 막는 까닭 — `null` 이면 누를 수 있다 */
  const taskBlocked = $derived.by<string | null>(() => {
    if (!host.backend.canWrite || !host.backend.writeText) return t("files.doc.task.block.readonly");
    if (editBlock === "truncated") return t("files.doc.edit.block.truncated");
    if (editBlock === "lossy" || editBlock === "binary") return t("files.doc.edit.block.lossy");
    if (host.offline) return t("files.doc.edit.block.offline");
    return null;
  });

  function setTaskBusy(line: number, on: boolean) {
    const next = new Set(taskBusy);
    if (on) next.add(line);
    else next.delete(line);
    taskBusy = next;
  }

  /** 읽기 보기의 체크박스 — 파일에 그 한 글자를 쓴다(차례로) */
  function toggleTask(line: number, wasChecked: boolean) {
    if (editing || taskBlocked !== null || taskBusy.has(line)) return;
    setTaskBusy(line, true);
    taskChain = taskChain
      .then(() => writeTask(line, wasChecked))
      .catch((e: unknown) => console.error("[aynx] 체크박스를 쓰지 못했습니다", e))
      .finally(() => setTaskBusy(line, false));
  }

  async function writeTask(line: number, wasChecked: boolean): Promise<void> {
    const target = file;
    const backend = host.backend;
    if (editing || !target || !backend.writeText || editBlockOf(target) !== null || host.offline) return;
    const next = toggleTaskLine(target.text, line, wasChecked);
    if (next === null) {
      // 그린 글과 지금 글이 어긋났다(앞 쓰기 · 다시 읽기) — 고치지 않고 지금 글을 다시 보여 준다
      host.onnotice(t("files.doc.task.stale"));
      void load();
      return;
    }
    try {
      const res = await backend.writeText(host.path, next, target.version);
      if (file === target && !editing) {
        target.text = next;
        target.size = res.size;
        target.version = res.version;
        updatedAt = new Date();
      }
      // 내가 쓴 것을 자동 새로고침이 "바뀜" 으로 보고 다시 읽지 않게 도장을 옮긴다
      stamp = await stampOf();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const outcome = saveFailureOf(message);
      if (outcome.ok) return;
      if (outcome.why === "conflict") host.onnotice(t("files.doc.task.conflict"));
      else if (outcome.why === "missing") host.onnotice(t("files.doc.task.missing"));
      else if (outcome.why === "gone") return; // 배너가 이미 말한다
      else host.onnotice(t("files.doc.task.failed", { message: stripReason(message) }));
      if (host.backend.online) void load();
    }
  }

  // ── 읽기 · 자동 새로고침 ─────────────────────────────────────────────────────

  async function load() {
    if (!host.backend.readText || host.path === "") return;
    const my = ++seq;
    loading = true;
    error = null;
    try {
      // 읽기 **전에** 도장을 찍는다 — 읽는 사이에 바뀌면 다음 박자가 다름을 보고 다시 읽는다(틈이 없다)
      const st = await stampOf();
      if (my !== seq) return;
      const got = await host.backend.readText(host.path);
      if (my !== seq) return;
      stamp = st;
      await accept(got);
    } catch (e) {
      if (my !== seq) return;
      error = failureOf(e);
    } finally {
      if (my === seq) loading = false;
    }
  }

  /** 지금 `stat` — 못 물으면 `null`(다음 박자가 기준을 새로 잡는다) */
  async function stampOf(): Promise<Stamp | null> {
    try {
      const e = await host.backend.stat(host.path);
      return { size: e.size, mtime: e.mtime };
    } catch {
      return null;
    }
  }

  /**
   * 타일이 화면에 보이는가 — 창이 가려졌거나(`visibilityState`) 조상이 `display: none` 이면(다른 탭 · 다른
   * 타일이 확대됨 — `PaneHost` 의 `.pane-box.hidden`) 상자가 하나도 없다.
   */
  function isVisible(): boolean {
    if (document.visibilityState !== "visible") return false;
    const rootEl = host.rootEl;
    return rootEl !== null && rootEl.getClientRects().length > 0;
  }

  /** 자동 새로고침 한 박자 — 묻고, 바뀌었으면 읽고, 다르면 들인다 */
  async function poll() {
    const gate = {
      visible: isVisible(),
      online: host.backend.online,
      sourceGone: host.sourceGone,
      hasFile: file !== null,
      error: error !== null,
      busy: loading || polling,
    };
    if (!shouldPoll(gate) || !host.backend.readText || host.path === "") return;
    polling = true;
    // 사람이 누른 새로고침 · 재연결 읽기(`++seq`)가 끼어들면 이 박자의 답은 버린다
    const my = seq;
    try {
      const e = await host.backend.stat(host.path);
      if (my !== seq) return;
      const next: Stamp = { size: e.size, mtime: e.mtime };
      if (!stampChanged(stamp, next)) return;
      const got = await host.backend.readText(host.path);
      if (my !== seq) return;
      stamp = next;
      await accept(got);
    } catch (e) {
      // 파일이 지워졌다 · 권한 — 띠가 서고 자동은 멈춘다(다시 시도가 푼다). 세션이 없다는 것은 배너 몫
      if (my === seq) error = failureOf(e);
    } finally {
      polling = false;
    }
  }

  /**
   * 읽은 것을 들인다 — `replacePlan` 대로. 통째로 바꿀 때는 스크롤을 지킨다: 맨 아래에 붙어 있었으면 맨 아래
   * (로그 꼬리), 아니면 보던 자리. 스크롤 상자는 같은 보기 안에서 그대로라 대개 저절로 남지만, 글이 줄면
   * 브라우저가 당겨 올리므로 한 번 되놓는다.
   */
  async function accept(got: TextFile) {
    // 편집 중에는 글을 바꾸지 않는다 — 디스크가 편집의 기준과 다르면 띠만 세운다(자동 새로고침 · 재연결 · 새로고침)
    if (editing) {
      bands = bandOnDisk(bands, baseVersion, got.version);
      return;
    }
    const plan = replacePlan(file, got);
    if (plan === "none") return;
    updatedAt = new Date();
    if (plan === "meta" && file) {
      file.size = got.size;
      file.truncated = got.truncated;
      file.version = got.version;
      return;
    }
    const el = file ? host.scroller() : null;
    const stick = el ? stuckToBottom(el.scrollTop, el.clientHeight, el.scrollHeight) : false;
    const top = el?.scrollTop ?? 0;
    const left = el?.scrollLeft ?? 0;
    file = got;
    if (!el) return;
    await tick();
    const now = host.scroller();
    if (!now) return;
    if (stick) now.scrollTop = now.scrollHeight;
    else now.scrollTo({ top, left });
  }

  /** 오류 → 화면 문구. 세션이 없다는 것은 오류로 적지 않는다(배너 몫) */
  function failureOf(e: unknown): string | null {
    const message = e instanceof Error ? e.message : String(e);
    return isSessionGone(message) ? null : stripReason(message);
  }

  async function openExternally() {
    const backend = host.backend;
    if (!backend.openExternal) return;
    try {
      await backend.openExternal(host.path);
    } catch (e) {
      error = failureOf(e);
    }
  }

  /** 외부 편집기로 편집(원격 — 받아서 로컬 편집기로 열고 저장하면 올린다). 도구줄 외부 열기 자리 · 이진 파일 안내에서 */
  async function editRemote(target: string = host.path) {
    const backend = host.backend;
    if (host.offline || !backend.edit) return;
    try {
      const opened = await backend.edit(target);
      host.onnotice(t("files.browser.edit.opened", { name: opened }));
    } catch (e) {
      error = failureOf(e);
    }
  }

  return {
    get file() {
      return file;
    },
    get loading() {
      return loading;
    },
    get editing() {
      return editing;
    },
    get error() {
      return error;
    },
    get updatedAt() {
      return updatedAt;
    },
    get editGen() {
      return editGen;
    },
    get dirty() {
      return dirty;
    },
    get saving() {
      return saving;
    },
    get savedFlash() {
      return savedFlash;
    },
    get bands() {
      return bands;
    },
    get editBlock() {
      return editBlock;
    },
    get taskBusy() {
      return taskBusy;
    },
    get taskBlocked() {
      return taskBlocked;
    },
    /** 편집기가 알린 더러움(`DocEditor` 의 `ondirty`) */
    setDirty(d: boolean) {
      dirty = d;
    },
    /** 띠의 [취소] · [닫기] */
    dismissBand() {
      bands = bandOnDismiss(bands);
    },
    /** 띠의 [무시] */
    ignoreBand() {
      bands = bandOnIgnore(bands);
    },
    startEdit,
    endEdit,
    save,
    reloadForEdit,
    editorFailed,
    toggleTask,
    load,
    poll,
    openExternally,
    editRemote,
    dispose,
  };
}
