// 문서 타일의 문서 상태(읽기 · 자동 새로고침 · 편집 · 저장 · 체크박스) — `DocView` 가 하나 만든다.
// 편집 미리 보기의 한때 값은 `DocView` 에 남고 여기서는 `onEditStart` · `onEditReload` · `stopPreviewTimer` 로 그 순서를 지킨다.
// `$effect` · 타이머 등록 · `app/doc-dirty` 등록은 `DocView` 가 쥔다 — 그 순서를 바꾸지 않는다.
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
import type { DocDraft, DocEditorRestore } from "$lib/doc-draft";

export interface DocSaveEditor {
  getText(): string;
  markSaved(text: string): void;
}

/** 게터라 그때그때의 값이다(생성 시점 사본이 아니다) */
export interface DocDocumentHost {
  readonly path: string;
  readonly backend: FsBackend;
  readonly offline: boolean;
  readonly sourceGone: boolean;
  readonly preview: boolean;
  readonly editor: DocSaveEditor | null;
  readonly rootEl: HTMLDivElement | null;
  scroller(): HTMLElement | null;
  onkeep(): void;
  onunkeep(): void;
  onnotice(message: string): void;
  onEditStart(text: string): void;
  onEditReload(text: string): void;
  stopPreviewTimer(): void;
}

export function createDocDocument(host: DocDocumentHost) {
  /** 끊겨도, 다시 읽다 실패해도 지우지 않는다 */
  let file = $state<TextFile | null>(null);
  let loading = $state(false);
  let editing = $state(false);
  let error = $state<string | null>(null);
  /** 늦게 온 답이 새 답을 덮지 않게 — 읽기마다 오른다 */
  let seq = 0;

  let stamp: Stamp | null = null;
  let polling = false;
  let updatedAt = $state<Date | null>(null);

  // ── 편집 ──

  let editGen = $state(0);
  let dirty = $state(false);
  let saving = $state(false);
  let savedFlash = $state(false);
  let savedTimer: ReturnType<typeof setTimeout> | null = null;
  /** 저장의 기대 version */
  let baseVersion = "";
  let bands = $state<BandState>(NO_BAND);
  /** 옮겨 온 초안으로 선 편집의 처음 글 · 되살릴 것 — 큰 글이라 `$state.raw` */
  let seed = $state.raw<{ text: string; restore: DocEditorRestore } | null>(null);

  const editBlock = $derived<EditBlock | null>(file ? editBlockOf(file) : null);

  /** 편집 때문에 고정했는가 — [편집 종료]에서 미리 보기로 돌려놓는다 */
  let keptForEdit = false;

  function startEdit() {
    if (!file || editBlockOf(file) !== null || !host.backend.canWrite || host.offline) return;
    // 편집하는 동안만 고정한다 — 편집이 끝나면 저장했어도 다시 미리 보기
    keptForEdit = host.preview;
    if (host.preview) host.onkeep();
    baseVersion = file.version;
    bands = NO_BAND;
    dirty = false;
    savedFlash = false;
    seed = null;
    editGen++;
    host.onEditStart(file.text);
    editing = true;
  }

  /**
   * 다른 창에서 옮겨 온 초안으로 편집을 잇는다 — 기준 version 은 초안의 것이라 디스크가 다르면 그냥 저장은 덮어쓰지 않는다.
   * 디스크가 다르면 기준 글을 모르므로(`baseText: null`) 저장할 때까지 dirty 다.
   */
  function startEditFromDraft(d: DocDraft): boolean {
    if (!file || editBlockOf(file) !== null || !host.backend.canWrite || host.offline) return false;
    keptForEdit = host.preview;
    if (host.preview) host.onkeep();
    baseVersion = d.baseVersion;
    bands = bandOnDisk(NO_BAND, d.baseVersion, file.version);
    dirty = false;
    savedFlash = false;
    seed = {
      text: d.text,
      restore: {
        eol: d.eol,
        baseText: file.version === d.baseVersion ? file.text : null,
        selection: d.selection,
        scrollPos: d.scrollPos,
        history: d.history,
      },
    };
    editGen++;
    host.onEditStart(d.text);
    editing = true;
    return true;
  }

  function endEdit() {
    editing = false;
    seed = null;
    host.stopPreviewTimer();
    if (keptForEdit) host.onunkeep();
    keptForEdit = false;
    dirty = false;
    bands = NO_BAND;
    savedFlash = false;
    host.rootEl?.focus({ preventScroll: true });
    if (host.backend.online) void load();
  }

  /** 사람이 누른 저장만 온다. `force`(기대 version 없이 쓰기)는 충돌 띠의 [덮어쓰기]뿐이다 */
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

  async function reloadForEdit() {
    if (!host.backend.readText || host.offline) return;
    const my = ++seq;
    loading = true;
    try {
      const st = await stampOf();
      // 백엔드 · 경로는 도장 뒤에 다시 읽는다 — 재연결이 끼어도 새 세션으로 읽는다
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
      seed = null;
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

  function editorFailed(message: string) {
    editing = false;
    dirty = false;
    error = t("files.doc.editor.failed", { message });
  }

  function dispose() {
    if (savedTimer) clearTimeout(savedTimer);
  }

  // ── 체크박스 ──

  let taskBusy = $state<ReadonlySet<number>>(new Set());
  /** 쓰기를 차례로 — 앞 쓰기가 옮긴 `version` 이 다음 쓰기의 기대값이다 */
  let taskChain: Promise<void> = Promise.resolve();

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
      // 그린 글과 지금 글이 어긋났다 — 고치지 않고 다시 읽는다
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

  // ── 읽기 · 자동 새로고침 ──

  async function load() {
    if (!host.backend.readText || host.path === "") return;
    const my = ++seq;
    loading = true;
    error = null;
    try {
      // 읽기 전에 도장을 찍는다 — 뒤에 찍으면 읽는 사이의 변경을 다음 박자가 놓친다
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

  async function stampOf(): Promise<Stamp | null> {
    try {
      const e = await host.backend.stat(host.path);
      return { size: e.size, mtime: e.mtime };
    } catch {
      return null;
    }
  }

  /** 조상이 `display: none`(다른 탭 · 다른 타일 확대 — `PaneHost` 의 `.pane-box.hidden`)이면 상자가 하나도 없다 */
  function isVisible(): boolean {
    if (document.visibilityState !== "visible") return false;
    const rootEl = host.rootEl;
    return rootEl !== null && rootEl.getClientRects().length > 0;
  }

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
      // 오류가 서면 `shouldPoll` 이 자동을 멈춘다
      if (my === seq) error = failureOf(e);
    } finally {
      polling = false;
    }
  }

  /** 통째로 바꿀 때 스크롤을 되놓는다 — 글이 줄면 브라우저가 당겨 올린다 */
  async function accept(got: TextFile) {
    // 편집 중에는 글을 바꾸지 않고 띠만 세운다
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

  /** 세션이 없다는 것은 오류로 적지 않는다 — 배너 몫 */
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
    get baseVersion() {
      return baseVersion;
    },
    get editText() {
      return seed?.text ?? file?.text ?? "";
    },
    get editRestore() {
      return seed?.restore ?? null;
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
    setDirty(d: boolean) {
      dirty = d;
    },
    dismissBand() {
      bands = bandOnDismiss(bands);
    },
    ignoreBand() {
      bands = bandOnIgnore(bands);
    },
    startEdit,
    startEditFromDraft,
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
