// 파일 타일의 목록 읽기 — 뿌리(`cwd`)와 그 목록 · 느린 읽기 깃발 · 오류 줄 · 트리 보기의 게으른 읽기(펼침·캐시·"더 보기").
// `SftpBrowser.svelte` 가 옛 상태 자리에서 하나 만든다. `$effect` 없음 — 백엔드 따라가기·새로고침 신호·게으른 읽기의
// 그물·시계 거두기 `$effect` 는 전부 `SftpBrowser` 에 남는다(효과의 순서·수명이 나누기 전과 같다).
import type { FsBackend } from "$lib/fs-backend";
import { isDirLike, isHidden, isSessionGone, type SftpEntry } from "$lib/sftp-browser";
import { TREE_PAGE, type FolderState } from "$lib/file-tree";
import { stripReason } from "$lib/error-reason";
import type { NavController } from "$lib/browser/nav-controller.svelte";
import type { SelectionController } from "$lib/browser/selection-controller.svelte";

/** 목록 읽기가 타일에서 읽고 부르는 것 — 전부 게터라 그때그때의 값이다 */
export interface FileListingHost {
  readonly backend: FsBackend;
  readonly offline: boolean;
  readonly isTree: boolean;
  readonly showHidden: boolean;
  /** 처음 열 경로 (`initialPath` 프롭) */
  readonly initialPath: string | null;
  readonly listEl: HTMLDivElement | null;
  readonly nav: NavController;
  readonly sel: SelectionController;
  /** 경로 칸의 편집 중인 값 — `bind:value` 라 `SftpBrowser` 에 산다 */
  pathDraft: string;
  readonly oncwd?: (dir: string) => void;
}

/**
 * 이만큼 넘게 걸리면 "읽는 중" 을 보여 준다. 사람이 "멈췄나?" 를 의심하기 시작하는
 * 언저리이면서, 흔한 로컬·근거리 목록은 대부분 이 안에 끝나 깜빡임이 없는 값이다.
 */
const SLOW_LOAD_MS = 200;

/**
 * 오류 하나를 화면에 적을 문구로 — **세션이 사라진 것은 오류로 적지 않는다**.
 *
 * 그때는 이미 "터미널이 연결되어 있지 않습니다" 배너가 같은 사실을 더 정확하게 말하고
 * 있다 (기다리면 돌아온다는 것까지). 그 위에 빨간 줄을 겹쳐 적으면 사용자는 무언가 고장
 * 났다고 읽고, 화면에는 [재시도] 라는 쓸모없는 버튼이 하나 더 생긴다.
 */
export function failureOf(e: unknown): string | null {
  const message = e instanceof Error ? e.message : String(e);
  return isSessionGone(message) ? null : stripReason(message);
}

/** 맵 하나를 갈아 끼운 사본 (`$state.raw` 는 새 객체를 대입해야 화면이 따라온다) */
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

  /**
   * 지금 보고 있는 절대 경로.
   *
   * **빈 문자열이 "아직 안 읽었다" 가 아니다** — 로컬에서는 그것이 합성 루트("내 PC")라는
   * 뜻이 있는 값이다 ([`FsBackend.isSyntheticRoot`]). 그래서 "한 번이라도 읽었는가" 는
   * 아래 [`hasCwd`] 가 따로 들고 있다.
   */
  cwd = $state("");
  /** 목록을 한 번이라도 읽었는가 — 첫 진입(홈/저장된 경로)과 새로고침을 가른다 */
  hasCwd = $state(false);
  /**
   * 뿌리(`cwd`)의 목록. **`$state.raw`** 다 — 통째로 갈아 끼우기만 하고 항목을 제자리에서 고치는
   * 일이 없는데, 깊은 반응형 프록시는 수천 줄짜리 폴더에서 항목마다 프록시를 만든다.
   */
  entries = $state.raw<SftpEntry[]>([]);
  loading = $state(false);

  // ── 트리 보기의 상태 (타일마다 · 메모리에만) ───────────────────────────────
  //
  // 셋 다 **통째로 갈아 끼운다**(`$state.raw`) — 집합·맵을 제자리에서 고치면 룬이 따라오지 않고,
  // 폴더 목록(수천 항목)을 깊은 프록시로 감쌀 이유도 없다.

  /** 펼친 폴더의 절대 경로 — 뿌리를 옮겨도 남는다(뿌리 아래에 있으면 그대로 펼쳐져 선다) */
  expanded = $state.raw<ReadonlySet<string>>(new Set());
  /** 폴더별 읽기 상태 — **캐시**다. 접어도 남고, 다시 펼치면 읽지 않고 이것을 그린다 */
  folders = $state.raw<ReadonlyMap<string, FolderState>>(new Map());
  /** 폴더별로 지금 몇 줄까지 폈는가 ("N개 더 보기" — `TREE_PAGE` 씩 는다) */
  limits = $state.raw<ReadonlyMap<string, number>>(new Map());
  /**
   * 지금 날아가 있는 폴더 읽기 — 경로 → 번호. 같은 폴더를 두 번 부르지 않고, 늦게 도착한 옛 답이
   * 새 답을 덮지 않게 한다. 화면이 읽지 않으므로 `$state` 가 아니다.
   */
  inflight = new Map<string, number>();
  fetchSeq = 0;
  /**
   * **읽기가 길어졌다** — 목록 자리에 스켈레톤을 세울 때가 됐다는 뜻.
   *
   * `loading` 과 나누는 이유가 곧 이 기능의 전부다: 로컬 폴더나 가까운 서버는 목록이
   * 몇십 ms 만에 오므로, `loading` 에 곧바로 스켈레톤을 걸면 폴더를 옮길 때마다 화면이
   * 한 번 **깜빡인다**. 그래서 [`SLOW_LOAD_MS`] 를 넘긴 읽기에만 이 깃발이 선다.
   */
  slowLoad = $state(false);
  slowTimer: ReturnType<typeof setTimeout> | undefined;
  /**
   * **그 자리에 남아야 하는 실패**만 여기 적는다 — 목록을 못 읽었다, 전송이 실패했다.
   * 그 줄에는 [재시도] 가 붙고, 무엇이 잘못됐는지가 화면에 남아 있어야 다음 손이 간다.
   *
   * 반대로 **조작이 거절된 안내**는 [`toast.error`] 로 나간다 — 고칠 것이 그 자리에 없고,
   * [재시도] 를 붙여 봐야 목록만 다시 읽을 뿐이라 버튼이 거짓말이 된다.
   */
  error = $state<string | null>(null);

  /**
   * 마지막으로 목록을 읽어 온 백엔드의 [`FsBackend.key`]. 여기에 **재연결 감지**가
   * 걸린다 — 값이 다르면 세션이 새로 열린 것이므로 같은 경로를 다시 읽는다.
   *
   * 객체 신원(`===`)이 아니라 키로 비교하는 이유: 상위가 리렌더할 때마다 같은 뜻의 새
   * 객체가 내려올 수 있는데, 그때마다 목록을 다시 읽으면 스크롤과 선택이 튄다.
   */
  loadedKey = $state<string | null>(null);

  constructor(h: FileListingHost) {
    this.#h = h;
  }

  // ── 목록 읽기 ───────────────────────────────────────────────────────────────

  /** 읽기를 시작한다 — 늦어지면 그때 스켈레톤을 세우도록 시계를 하나 건다 */
  beginLoad = () => {
    this.loading = true;
    clearTimeout(this.slowTimer);
    this.slowTimer = setTimeout(() => {
      if (this.loading) this.slowLoad = true;
    }, SLOW_LOAD_MS);
  };

  /** 읽기가 끝났다 (성공이든 실패든) — 시계와 깃발을 함께 거둔다 */
  endLoad = () => {
    this.loading = false;
    this.slowLoad = false;
    clearTimeout(this.slowTimer);
  };

  /**
   * 한 경로를 읽어 화면에 붙인다 — 성공하면 `true`. **실패하면 `entries` 를 건드리지
   * 않는다** — 보고 있던 목록을 오류 때문에 지우면 사용자는 방금까지 보이던 것마저 잃는다.
   *
   * `keep` 에 경로를 주면 새로고침 뒤 그것들을 **골라 둔다** — 이름 변경·만들기 직후의 그
   * 항목, 붙여넣기·드롭이 방금 놓아 준 것들이 그렇다. 목록에 없는 경로는 정리 효과
   * (`sel.prune`)가 조용히 떨어낸다.
   */
  load = async (path: string, keep: readonly string[] = []): Promise<boolean> => {
    if (this.#h.offline) return false;
    const key = this.#h.backend.key;
    // **같은 뿌리를 다시 읽는가**(새로고침·전송 뒤·재연결) — 트리면 펼쳐 둔 폴더도 함께 다시 읽는다.
    // 다른 뿌리로 옮기는 것(들어가기·뒤로·빵부스러기)은 캐시를 그대로 쓴다(없는 것만 게으르게 읽는다).
    const same = this.hasCwd && path === this.cwd;
    this.beginLoad();
    this.error = null;
    try {
      const list = await this.#h.backend.list(path);
      // 펼친 폴더를 **선택을 앉히기 전에** 다시 읽는다 — 하위 폴더에 붙여넣은 것(`keep`)이 목록에
      // 아직 없으면 정리 효과(`sel.prune`)가 그 사이에 선택을 떨어내 버린다.
      if (this.#h.isTree && same) await this.relistExpanded(list);
      this.entries = list;
      // 뿌리 목록도 캐시에 적어 둔다 — ↑ 로 올라간 뒤 옛 뿌리를 펼치면 곧바로 선다.
      this.folders = withFolder(this.folders, path, { status: "ok", entries: list });
      const moved = path !== this.cwd;
      this.cwd = path;
      this.hasCwd = true;
      this.#h.pathDraft = path;
      this.loadedKey = key;
      // **여기가 이력의 유일한 입구다** — `cwd` 를 바꾸는 길이 이 함수 하나뿐이라
      // (들어가기·빵부스러기·경로 칸·↑·홈·재연결이 전부 여기로 온다) 새 진입점이 생겨도
      // 이력에 빠지는 일이 없다. 새로고침·재연결은 같은 경로라 모델이 알아서 무시한다.
      this.#h.nav.push(path);
      this.#h.oncwd?.(path);
      if (keep.length > 0) this.#h.sel.set({ anchor: keep[0], focus: keep[0], ids: new Set(keep) });
      else this.#h.sel.clear();
      // 새 폴더로 들어갔으면 맨 위부터 보는 것이 맞다 (스크롤이 남아 있으면 헷갈린다). 같은 폴더를
      // 다시 읽은 것이면 두는 것이 맞다 — 트리를 깊이 펼쳐 둔 채 새로고침할 때마다 맨 위로 튀면 안 된다.
      if (moved && keep.length === 0 && this.#h.listEl) this.#h.listEl.scrollTop = 0;
      return true;
    } catch (e) {
      this.error = failureOf(e);
      return false;
    } finally {
      this.endLoad();
    }
  };

  // ── 트리 — 게으른 읽기 · 펼치기 · 접기 ─────────────────────────────────────

  setExpanded = (path: string, open: boolean) => {
    if (this.expanded.has(path) === open) return;
    const next = new Set(this.expanded);
    if (open) next.add(path);
    else next.delete(path);
    this.expanded = next;
  };

  /**
   * 폴더 하나를 읽어 캐시에 적는다 — 돌려주는 값은 읽은 목록(실패면 `null`).
   *
   * 이미 목록을 알고 있으면 다시 읽는 동안 **옛 목록을 그대로 둔다**(새로고침 중에 줄이 "읽는 중"
   * 으로 깜빡이지 않게). 실패는 그 폴더 줄의 오류로 남고(`FolderState.error`) 펼침은 풀린다 —
   * 다시 펼치면 다시 읽는다. **세션이 사라진 것은 오류로 적지 않는다**(`failureOf` — 배너가 이미
   * 말한다): 그때는 캐시에서 지워 다음에 붙으면 다시 읽게 둔다.
   */
  fetchFolder = async (path: string): Promise<readonly SftpEntry[] | null> => {
    if (this.#h.offline) return null;
    const key = this.#h.backend.key;
    const ticket = ++this.fetchSeq;
    this.inflight.set(path, ticket);
    if (this.folders.get(path)?.status !== "ok") this.folders = withFolder(this.folders, path, { status: "loading" });
    try {
      const list = await this.#h.backend.list(path);
      if (this.inflight.get(path) !== ticket || this.#h.backend.key !== key) return null; // 늦게 온 옛 답
      this.folders = withFolder(this.folders, path, { status: "ok", entries: list });
      return list;
    } catch (e) {
      if (this.inflight.get(path) !== ticket) return null;
      const message = failureOf(e);
      // 세션이 사라졌다 — 상태를 그대로 둔다("읽는 중" 이면 그대로 읽는 중). 지우면 게으른 읽기의
      // 그물이 끊긴 세션에 곧바로 다시 부른다. 다시 붙으면 재연결 읽기(`load` → 다시 읽기)가 채운다.
      if (message === null) return null;
      this.folders = withFolder(this.folders, path, { status: "error", message });
      this.setExpanded(path, false);
      return null;
    } finally {
      if (this.inflight.get(path) === ticket) this.inflight.delete(path);
    }
  };

  /**
   * 뿌리 목록 `list` 아래로 **보이는 펼친 폴더를 전부 다시 읽는다** — 새로고침·전송 뒤·재연결.
   * 층마다 한꺼번에(`Promise.all`) 부르고, 새 목록을 따라 다음 층으로 내려간다(지워진 폴더는
   * 거기서 멈춘다). 숨김이 꺼져 있으면 숨김 폴더 아래는 보이지 않으므로 읽지 않는다.
   */
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

  /**
   * 폴더 하나를 **펼친다** — 캐시에 목록이 있으면 읽지 않고 곧바로 선다(캐시), 없거나 지난번에
   * 실패했으면 읽는다. 로컬·원격 모두 같은 길이다.
   */
  expand = (path: string) => {
    if (this.#h.offline) return;
    // 지난번 실패는 지우고 펼친다 — 오류 상태 그대로면 모형이 펼침을 무시한다(다시 읽는 동안 "읽는 중")
    if (this.folders.get(path)?.status === "error") this.folders = withFolder(this.folders, path, null);
    this.setExpanded(path, true);
    if (this.folders.get(path)?.status !== "ok" && !this.inflight.has(path)) void this.fetchFolder(path);
  };

  /** 폴더 하나를 접는다 — 캐시와 그 아래의 펼침은 남는다(다시 펼치면 그대로 선다) */
  collapse = (path: string) => {
    this.setExpanded(path, false);
  };

  /** "N개 더 보기" — 그 폴더를 `TREE_PAGE` 줄 더 편다 */
  showMore = (parent: string) => {
    const next = new Map(this.limits);
    next.set(parent, (this.limits.get(parent) ?? TREE_PAGE) + TREE_PAGE);
    this.limits = next;
  };

  /** 홈에서 시작한다. 홈조차 못 물으면 그 오류를 그대로 보여 준다 */
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

  /**
   * 첫 진입 — **저장된 경로가 있으면 거기서**, 없으면 홈에서 시작한다.
   *
   * 배치를 복원한 뒤 그 폴더가 사라졌을 수 있다. 그때 빈 화면으로 두면 사용자는 타일이
   * 고장 났다고 읽으므로, **오류 한 줄은 남기고 홈으로 떨어진다**.
   */
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
