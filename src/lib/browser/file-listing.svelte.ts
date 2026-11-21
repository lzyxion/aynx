// 파일 타일의 목록 읽기. `$effect` 는 두지 않는다 — 효과의 순서 · 수명은 `SftpBrowser` 가 쥔다.
import type { FsBackend } from "$lib/fs-backend";
import { isDirLike, isHidden, isSessionGone, type SftpEntry } from "$lib/sftp-browser";
import { TREE_PAGE, type FolderState } from "$lib/file-tree";
import { stripReason } from "$lib/error-reason";
import type { NavController } from "$lib/browser/nav-controller.svelte";
import type { SelectionController } from "$lib/browser/selection-controller.svelte";

/** 전부 게터라 그때그때의 값이다 */
export interface FileListingHost {
  readonly backend: FsBackend;
  readonly offline: boolean;
  readonly isTree: boolean;
  readonly showHidden: boolean;
  readonly initialPath: string | null;
  readonly listEl: HTMLDivElement | null;
  readonly nav: NavController;
  readonly sel: SelectionController;
  /** `bind:value` 라 `SftpBrowser` 에 산다 */
  pathDraft: string;
  readonly oncwd?: (dir: string) => void;
}

/** 흔한 로컬 · 근거리 목록은 이 안에 끝나 스켈레톤이 깜빡이지 않는다 */
const SLOW_LOAD_MS = 200;

/** 세션이 사라진 것은 오류로 적지 않는다(`null`) — 연결 끊김 배너가 이미 말하고, 겹치면 쓸모없는 [재시도] 가 생긴다 */
export function failureOf(e: unknown): string | null {
  const message = e instanceof Error ? e.message : String(e);
  return isSessionGone(message) ? null : stripReason(message);
}

/** `$state.raw` 는 새 객체를 대입해야 화면이 따라온다 */
function withFolder(
  map: ReadonlyMap<string, FolderState>,
  path: string,
  state: FolderState | null,
): ReadonlyMap<string, FolderState> {
  const next = new Map(map);
  if (state === null) next.delete(path);
  else next.set(path, state);
  return next;
}

export class FileListing {
  #h: FileListingHost;

  /** 빈 문자열은 "아직 안 읽었다" 가 아니라 로컬의 합성 루트("내 PC")다 — 읽었는지는 [`hasCwd`] 가 든다 */
  cwd = $state("");
  hasCwd = $state(false);
  /** `$state.raw` — 깊은 프록시는 수천 줄 폴더에서 항목마다 프록시를 만든다 */
  entries = $state.raw<SftpEntry[]>([]);
  loading = $state(false);

  // ── 트리 보기의 상태 ── 통째로 갈아 끼운다 — 집합 · 맵을 제자리에서 고치면 룬이 따라오지 않는다

  expanded = $state.raw<ReadonlySet<string>>(new Set());
  /** 캐시다 — 접어도 남고, 다시 펼치면 읽지 않고 이것을 그린다 */
  folders = $state.raw<ReadonlyMap<string, FolderState>>(new Map());
  limits = $state.raw<ReadonlyMap<string, number>>(new Map());
  /** 경로 → 번호 — 늦게 도착한 옛 답이 새 답을 덮지 않게 한다 */
  inflight = new Map<string, number>();
  fetchSeq = 0;
  /** `loading` 과 따로 둔다 — `loading` 에 곧바로 스켈레톤을 걸면 폴더를 옮길 때마다 깜빡인다 */
  slowLoad = $state(false);
  slowTimer: ReturnType<typeof setTimeout> | undefined;
  /** 그 자리에 남아야 하는 실패만 — 조작이 거절된 안내는 토스트로 낸다([재시도] 가 거짓말이 된다) */
  error = $state<string | null>(null);

  /** 재연결 감지 — 객체 신원이 아니라 키로 본다(리렌더마다 새 객체가 내려와 스크롤 · 선택이 튄다) */
  loadedKey = $state<string | null>(null);

  constructor(h: FileListingHost) {
    this.#h = h;
  }

  // ── 목록 읽기 ──

  beginLoad = () => {
    this.loading = true;
    clearTimeout(this.slowTimer);
    this.slowTimer = setTimeout(() => {
      if (this.loading) this.slowLoad = true;
    }, SLOW_LOAD_MS);
  };

  endLoad = () => {
    this.loading = false;
    this.slowLoad = false;
    clearTimeout(this.slowTimer);
  };

  /** 실패하면 `entries` 를 건드리지 않는다 — 보고 있던 목록마저 잃는다 */
  load = async (path: string, keep: readonly string[] = []): Promise<boolean> => {
    if (this.#h.offline) return false;
    const key = this.#h.backend.key;
    const same = this.hasCwd && path === this.cwd;
    this.beginLoad();
    this.error = null;
    try {
      const list = await this.#h.backend.list(path);
      // 선택을 앉히기 전에 — 하위 폴더에 붙여넣은 것(`keep`)이 아직 없으면 `sel.prune` 이 선택을 떨어낸다
      if (this.#h.isTree && same) await this.relistExpanded(list);
      this.entries = list;
      this.folders = withFolder(this.folders, path, { status: "ok", entries: list });
      const moved = path !== this.cwd;
      this.cwd = path;
      this.hasCwd = true;
      this.#h.pathDraft = path;
      this.loadedKey = key;
      // 이력의 유일한 입구다 — `cwd` 를 바꾸는 길은 이 함수 하나여야 이력에 빠지는 진입점이 없다
      this.#h.nav.push(path);
      this.#h.oncwd?.(path);
      if (keep.length > 0) this.#h.sel.set({ anchor: keep[0], focus: keep[0], ids: new Set(keep) });
      else this.#h.sel.clear();
      // 같은 폴더를 다시 읽은 것이면 스크롤을 둔다 — 새로고침마다 맨 위로 튀면 안 된다
      if (moved && keep.length === 0 && this.#h.listEl) this.#h.listEl.scrollTop = 0;
      return true;
    } catch (e) {
      this.error = failureOf(e);
      return false;
    } finally {
      this.endLoad();
    }
  };

  // ── 트리 — 게으른 읽기 · 펼치기 · 접기 ──

  setExpanded = (path: string, open: boolean) => {
    if (this.expanded.has(path) === open) return;
    const next = new Set(this.expanded);
    if (open) next.add(path);
    else next.delete(path);
    this.expanded = next;
  };

  /** 이미 목록을 알면 다시 읽는 동안 옛 목록을 둔다 — 새로고침 중에 줄이 "읽는 중" 으로 깜빡이지 않게 */
  fetchFolder = async (path: string): Promise<readonly SftpEntry[] | null> => {
    if (this.#h.offline) return null;
    const key = this.#h.backend.key;
    const ticket = ++this.fetchSeq;
    this.inflight.set(path, ticket);
    if (this.folders.get(path)?.status !== "ok") this.folders = withFolder(this.folders, path, { status: "loading" });
    try {
      const list = await this.#h.backend.list(path);
      if (this.inflight.get(path) !== ticket || this.#h.backend.key !== key) return null;
      this.folders = withFolder(this.folders, path, { status: "ok", entries: list });
      return list;
    } catch (e) {
      if (this.inflight.get(path) !== ticket) return null;
      const message = failureOf(e);
      // 세션이 사라졌으면 상태를 그대로 둔다 — 지우면 게으른 읽기의 그물이 끊긴 세션에 곧바로 다시 부른다
      if (message === null) return null;
      this.folders = withFolder(this.folders, path, { status: "error", message });
      this.setExpanded(path, false);
      return null;
    } finally {
      if (this.inflight.get(path) === ticket) this.inflight.delete(path);
    }
  };

  relistExpanded = async (list: readonly SftpEntry[]): Promise<void> => {
    const open = list.filter(
      (e) => isDirLike(e) && this.expanded.has(e.path) && (this.#h.showHidden || !isHidden(e)),
    );
    await Promise.all(
      open.map(async (e) => {
        const children = await this.fetchFolder(e.path);
        if (children) await this.relistExpanded(children);
      }),
    );
  };

  expand = (path: string) => {
    if (this.#h.offline) return;
    // 지난번 실패는 지우고 펼친다 — 오류 상태 그대로면 모형이 펼침을 무시한다
    if (this.folders.get(path)?.status === "error") this.folders = withFolder(this.folders, path, null);
    this.setExpanded(path, true);
    if (this.folders.get(path)?.status !== "ok" && !this.inflight.has(path)) void this.fetchFolder(path);
  };

  collapse = (path: string) => {
    this.setExpanded(path, false);
  };

  showMore = (parent: string) => {
    const next = new Map(this.limits);
    next.set(parent, (this.limits.get(parent) ?? TREE_PAGE) + TREE_PAGE);
    this.limits = next;
  };

  loadHome = async () => {
    if (this.#h.offline) return;
    this.beginLoad();
    this.error = null;
    try {
      const home = await this.#h.backend.home();
      await this.load(home);
    } catch (e) {
      this.error = failureOf(e);
      this.endLoad();
    }
  };

  /** 저장된 폴더가 사라졌으면 오류 한 줄은 남기고 홈으로 떨어진다 — 빈 화면은 고장으로 읽힌다 */
  loadStart = async () => {
    const start = this.#h.initialPath?.trim();
    if (!start) {
      await this.loadHome();
      return;
    }
    if (await this.load(start)) return;
    const failure = this.error;
    await this.loadHome();
    if (failure) this.error = failure;
  };
}
