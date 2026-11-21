// diff 타일의 줄 코멘트 상태 — 코멘트는 타일 메모리에만 산다(명세 · 배치 파일 · 디스크에 싣지 않는다).
// 넘기기는 붙여 넣기만이다(Enter 없음).
import { tick } from "svelte";
import { t } from "$lib/i18n/i18n.svelte.js";
import { copyDiffText, diffHostLabel, diffTargets, pasteDiffText } from "$lib/app/diff-view.svelte.js";
import {
  buildDiffPasteText,
  commentCounts,
  linesOf,
  rangeLabel,
  type DiffComment,
  type DiffCommentWhere,
} from "$lib/diff-comments";
import type { Project } from "$lib/projects";
import type { DiffEntry, DiffFiles, DiffLine, DiffSpec } from "$lib/diff-view";

/** 연 순간의 파일 · 줄 · 자리를 들고 있어 그사이 범위를 바꿔도 대상이 그대로다(`editing` = 고치는 코멘트 id) */
export type DiffComposer = { path: string; keys: string[]; lines: DiffLine[]; label: string; editing: number | null } & DiffCommentWhere;

/** 게터라 그때그때의 값이다(생성 시점 사본이 아니다) */
export interface DiffCommentsHost {
  readonly paneId: string;
  readonly spec: DiffSpec;
  readonly project: Project | null;
  readonly files: DiffFiles | null;
  readonly branch: string | null;
  readonly worktree: string | null;
  readonly current: DiffEntry | null;
  readonly here: DiffCommentWhere | null;
  readonly selKeys: string[];
  readonly allLines: DiffLine[];
  readonly rootEl: HTMLDivElement | null;
  clearSelection(): void;
}

export function createDiffComments(h: DiffCommentsHost) {
  let comments = $state<DiffComment[]>([]);
  let nextCommentId = 1;
  /** 연 순간의 파일 · 줄 · 자리를 들고 있어 그사이 범위를 바꿔도 대상이 그대로다(`editing` = 고치는 코멘트 id) */
  let composer = $state<DiffComposer | null>(null);
  let draft = $state("");
  let composerEl = $state<HTMLTextAreaElement | null>(null);
  let targetMenu = $state(false);
  let targetId = $state<string | null>(null);

  const commentCount = $derived(commentCounts(comments));
  const unsent = $derived(comments.filter((c) => !c.sent));
  const targets = $derived(h.project ? diffTargets(h.project, h.worktree, h.paneId) : null);
  const target = $derived(
    targets ? (targets.tiles.find((x) => x.paneId === targetId) ?? targets.tiles[targets.selected] ?? null) : null,
  );

  function openComposer(): void {
    const current = h.current;
    const here = h.here;
    const selKeys = h.selKeys;
    if (!current || !here || selKeys.length === 0) return;
    const lines = linesOf(h.allLines, selKeys);
    composer = { path: current.path, keys: [...selKeys], lines, label: rangeLabel(lines, t), editing: null, ...here };
    draft = "";
    void tick().then(() => composerEl?.focus());
  }

  function cancelComposer(): void {
    composer = null;
    draft = "";
    h.rootEl?.focus({ preventScroll: true });
  }

  function submitComposer(): void {
    const c = composer;
    const text = draft.trim();
    if (!c || text === "") return;
    if (c.editing !== null) {
      comments = comments.map((x) => (x.id === c.editing ? { ...x, text, sent: false } : x));
    } else {
      comments = [
        ...comments,
        {
          id: nextCommentId++,
          path: c.path,
          keys: c.keys,
          lines: c.lines,
          label: c.label,
          text,
          sent: false,
          scope: c.scope,
          commit: c.commit,
          group: c.group,
        },
      ];
    }
    composer = null;
    draft = "";
    h.clearSelection();
    h.rootEl?.focus({ preventScroll: true });
  }

  /** Esc 는 전파를 끊는다 — 타일 · 창의 Esc 가 같이 돌지 않게 */
  function onComposerKey(ev: KeyboardEvent): void {
    if (ev.isComposing || ev.keyCode === 229) return;
    if (ev.code === "Enter" && ev.ctrlKey && !ev.altKey && !ev.shiftKey) {
      ev.preventDefault();
      submitComposer();
    } else if (ev.code === "Escape") {
      ev.preventDefault();
      ev.stopPropagation();
      cancelComposer();
    }
  }

  function editComment(c: DiffComment): void {
    composer = { path: c.path, keys: c.keys, lines: c.lines, label: c.label, editing: c.id, scope: c.scope, commit: c.commit, group: c.group };
    draft = c.text;
    void tick().then(() => composerEl?.focus());
  }

  function deleteComment(c: DiffComment): void {
    comments = comments.filter((x) => x.id !== c.id);
    if (composer?.editing === c.id) composer = null;
  }

  function pasteText(list: readonly DiffComment[]): string {
    const p = h.project;
    const spec = h.spec;
    const worktree = h.worktree;
    return buildDiffPasteText(
      {
        branch: h.branch,
        scope: spec.scope,
        main: h.files?.main ?? null,
        commit: spec.commit ?? h.files?.tip ?? null,
        host: p ? diffHostLabel(p) : "",
        folder: worktree ?? p?.path ?? null,
        comments: list,
      },
      t,
    );
  }

  /** 붙여 넣기만(Enter 없음) */
  async function handOver(): Promise<void> {
    const list = unsent;
    if (list.length === 0) return;
    if (!target) {
      await copyDiffText(pasteText(list));
      return;
    }
    const ids = new Set(list.map((c) => c.id));
    if (pasteDiffText(target, pasteText(list))) comments = comments.map((c) => (ids.has(c.id) ? { ...c, sent: true } : c));
  }

  function clearSent(): void {
    comments = comments.filter((c) => !c.sent);
  }

  const closeTargetMenu = () => (targetMenu = false);

  function pickTarget(tile: { paneId: string }): void {
    targetId = tile.paneId;
  }

  return {
    get comments() {
      return comments;
    },
    get composer() {
      return composer;
    },
    get draft() {
      return draft;
    },
    set draft(v: string) {
      draft = v;
    },
    get composerEl() {
      return composerEl;
    },
    set composerEl(v: HTMLTextAreaElement | null) {
      composerEl = v;
    },
    get targetMenu() {
      return targetMenu;
    },
    set targetMenu(v: boolean) {
      targetMenu = v;
    },
    get commentCount() {
      return commentCount;
    },
    get unsent() {
      return unsent;
    },
    get targets() {
      return targets;
    },
    get target() {
      return target;
    },
    openComposer,
    cancelComposer,
    submitComposer,
    onComposerKey,
    editComment,
    deleteComment,
    handOver,
    clearSent,
    closeTargetMenu,
    pickTarget,
  };
}

export type DiffCommentsController = ReturnType<typeof createDiffComments>;
