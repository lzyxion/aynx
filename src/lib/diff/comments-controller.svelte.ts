// **diff 타일의 줄 코멘트 상태** — `DiffView.svelte` 에서 그대로 옮긴 컨트롤러(2026-10-27 분할 5차).
// `DiffView` 가 하나 만들고(`createDiffComments` — 지금 파일 · 자리 · 고른 줄 · 명세는 게터로) 값은 게터로 읽는다.
//
// 쥐는 것: 코멘트(타일 메모리에만 — 명세 · 배치 파일 · 디스크에 싣지 않는다) · 쓰는 중인 코멘트(`composer` — 연 순간의 파일 · 줄 ·
// 자리(범위 · 커밋 · 묶음)를 들고 있어 그사이 범위를 바꿔도 대상이 그대로다) · 입력 글 · 받을 곳(AI 타일) 고르개 · 넘기기.
// 넘기기는 **붙여 넣기만**이다(Enter 없음 — `app/diff-view` 의 `pasteDiffText`). AI 타일이 없으면 복사.
//
// `$effect` · 리스너는 없다. 줄 고르기(시작 · 끝 줄 · 끄는 중) · 칩 → 그 줄로 가기(`jumpTo`) · 카드 · 입력 칸의 자리(`cardsAt` ·
// `composerAt` — 보기마다 다른 짝 줄 자리)는 `DiffView` 에 있다.
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

/** 쓰는 중인 코멘트 — 그 파일 · 그 줄들 아래에 선다(`editing` = 고치는 코멘트 id) */
export type DiffComposer = { path: string; keys: string[]; lines: DiffLine[]; label: string; editing: number | null } & DiffCommentWhere;

/** `DiffView` 가 넘기는 값 — **게터**라 그때그때의 값이다(생성 시점 사본이 아니다). */
export interface DiffCommentsHost {
  readonly paneId: string;
  readonly spec: DiffSpec;
  readonly project: Project | null;
  /** 읽은 파일 목록(답) — 붙여 넣을 글의 main · 끝 커밋 */
  readonly files: DiffFiles | null;
  readonly branch: string | null;
  readonly worktree: string | null;
  /** 지금 보는 파일 */
  readonly current: DiffEntry | null;
  /** 지금 보는 파일의 자리 — 범위 · 커밋 · 묶음 */
  readonly here: DiffCommentWhere | null;
  /** 고른 줄 열쇠(차례대로) */
  readonly selKeys: string[];
  /** 지금 파일의 모든 줄 */
  readonly allLines: DiffLine[];
  /** 타일 뿌리 — 입력 칸을 닫으면 포커스를 돌려준다 */
  readonly rootEl: HTMLDivElement | null;
  /** 줄 고르기를 걷는다(시작 · 끝 줄) */
  clearSelection(): void;
}

/** 줄 코멘트 하나를 만든다 — 상태는 이 안에 살고 읽기는 게터로 */
export function createDiffComments(h: DiffCommentsHost) {
  let comments = $state<DiffComment[]>([]);
  let nextCommentId = 1;
  /** 쓰는 중인 코멘트 — 그 파일 · 그 줄들 아래에 선다(`editing` = 고치는 코멘트 id) */
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

  /** 입력 칸의 키 — Ctrl+Enter 추가 · Esc 취소(전파를 끊어 타일 · 창의 Esc 가 같이 돌지 않게) */
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

  /** 붙여 넣을 글 — 넘기지 않은 코멘트만 */
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

  /** AI 타일에 넘기기 — 붙여 넣기만(Enter 없음). 넣었으면 그 코멘트들을 "넘김" 으로. AI 타일이 없으면 복사 */
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
    /** 입력 칸의 글(`CommentComposer` 가 묶는다) */
    get draft() {
      return draft;
    },
    set draft(v: string) {
      draft = v;
    },
    /** 입력 칸(`CommentComposer` 가 묶는다) */
    get composerEl() {
      return composerEl;
    },
    set composerEl(v: HTMLTextAreaElement | null) {
      composerEl = v;
    },
    /** 받을 곳 고르개가 열렸나(`CommentTray` 가 묶고, 바깥 누르기 · Esc 가 닫는다) */
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
