// 문서 타일의 파일 칸 상태 — 곁 패널 · 드롭다운이 같이 쓴다(`doc/outline-controller.svelte.ts` 의 짝). `$effect` 는 `DocView` 가 쥔다.
// 목록 스크롤은 `listScroll` 하나가 기억한다 — 한 번만 꺼내는 씨앗 값을 따로 두면 좁은 새 타일의 첫 프레임에 잠깐 선 곁 패널이
// 꺼내 가 나중에 여는 드롭다운이 0 에서 선다.
import { t } from "$lib/i18n/i18n.svelte.js";
import { DROPDOWN_GAP } from "$lib/dropdown";
import { stripReason } from "$lib/error-reason";
import { filterFiles, scanTextFiles, splitRel } from "$lib/file-picker";
import {
  acceptFilesSeed,
  folderRows,
  hasParent,
  samePath,
  type DocFileRow,
  type DocFilesScan,
  type DocFilesSeed,
  type FolderRows,
} from "$lib/doc-files";
import type { FsBackend } from "$lib/fs-backend";
import { moveStartSelection } from "$lib/project-start";
import { isSessionGone } from "$lib/sftp-browser";

/** 게터라 그때그때의 값이다(생성 시점 사본이 아니다) — `seed` 만 생성 때 한 번 읽는다 */
export interface DocFilesHost {
  readonly backend: FsBackend;
  readonly path: string;
  readonly sourceGone: boolean;
  root(): HTMLElement | null;
  /** 지금 문서와 같아도 그대로 올린다 — "다시 고름" 은 app 층이 가른다 */
  onpick(path: string): void;
  /** 이 타일에서 문서를 바꾸며 옛 칸이 넘긴 상태(`doc-swap.ts`) — 원본(`backend.key`)이 같을 때만 받는다 */
  readonly seed?: DocFilesSeed | null;
}

/** 찾기 결과면 `sub` 에 상대 폴더(뿌리 바로 아래면 `""`) */
export type DocFilesItem = DocFileRow & { sub?: string };

export type DocFilesStatus =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ready" }
  | { state: "offline"; reason: "offline" | "gone" };

const NO_ROWS: FolderRows = { rows: [], more: 0 };

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function createDocFiles(host: DocFilesHost) {
  const seed = acceptFilesSeed(host.seed, host.backend.key);
  let dir = $state(seed ? seed.dir : host.backend.parentOf(host.path));
  let browse = $state.raw<FolderRows>(seed ? seed.browse : NO_ROWS);
  /** `browse` 가 어느 폴더의 것인가 */
  let browseFor: string | null = seed ? seed.browseFor : null;
  let loadState = $state<DocFilesStatus>(seed?.ready ? { state: "ready" } : { state: "loading" });
  let query = $state(seed ? seed.query : "");
  let scan = $state.raw<DocFilesScan>(seed ? seed.scan : { state: "idle" });
  /** `scan` 이 어느 원본 · 폴더의 것인가 */
  let scanFor = seed ? seed.scanFor : "";
  let active = $state(seed ? seed.active : 0);
  /** 반응형이 아니다 — 서는 순간과 폴더 · 질의 변화에만 읽힌다 */
  let listScroll = seed ? seed.scrollTop : 0;
  let listSeq = 0;
  let scanSeq = 0;

  let drop = $state<{ x: number; y: number; w: number; maxH: number } | null>(null);
  let button = $state<HTMLButtonElement | null>(null);

  const forKey = () => `${host.backend.key}\n${dir}`;

  const blocked = $derived(!host.backend.online || host.sourceGone);
  const status = $derived<DocFilesStatus>(
    host.sourceGone
      ? { state: "offline", reason: "gone" }
      : !host.backend.online
        ? { state: "offline", reason: "offline" }
        : loadState,
  );
  const findBlocked = $derived(host.backend.isSyntheticRoot(dir));
  const searching = $derived(query.trim() !== "" && !findBlocked);
  const dirName = $derived.by(() => {
    const crumbs = host.backend.crumbsOf(dir);
    const last = crumbs[crumbs.length - 1];
    return last ? (last.labelKey ? t(last.labelKey) : last.label) : dir;
  });
  const hits = $derived<DocFilesItem[]>(
    searching && scan.state === "ready"
      ? filterFiles(scan.files, query).map((f) => {
          const parts = splitRel(f.rel);
          return { kind: "file", name: parts.name, path: f.path, sub: parts.dir };
        })
      : [],
  );
  const items = $derived<DocFilesItem[]>(searching ? hits : browse.rows);
  const activeIndex = $derived(items.length === 0 ? -1 : Math.min(Math.max(0, active), items.length - 1));

  async function load(): Promise<void> {
    const my = ++listSeq;
    const key = forKey();
    // 질의가 남아 있으면 새로 훑는다 — 끊김으로 놓친 훑기도
    if (scanFor !== key || scan.state === "idle") {
      if (scan.state !== "idle") {
        scanSeq += 1;
        scan = { state: "idle" };
      }
      if (searching && !blocked) void startScan();
    }
    if (blocked) return;
    const b = host.backend;
    const d = dir;
    // 줄이 서 있던 같은 폴더 다시 읽기는 "읽는 중" 으로 돌리지 않는다 — 넘겨받은 칸의 첫 읽기에서 빈 폴더 문구가 깜빡인다
    if (browseFor !== d) browse = NO_ROWS;
    if (browseFor !== d || loadState.state !== "ready") loadState = { state: "loading" };
    try {
      const entries = await b.list(d);
      if (my !== listSeq) return;
      browse = folderRows(entries, { parent: hasParent(d, b.parentOf) ? b.parentOf(d) : null });
      browseFor = d;
      loadState = { state: "ready" };
    } catch (e) {
      if (my !== listSeq) return;
      const msg = messageOf(e);
      loadState = isSessionGone(msg) ? { state: "offline", reason: "offline" } : { state: "error", message: stripReason(msg) };
    }
  }

  async function startScan(): Promise<void> {
    const my = ++scanSeq;
    if (blocked || findBlocked) return;
    const b = host.backend;
    const d = dir;
    scanFor = forKey();
    scan = { state: "scanning" };
    try {
      const got = await scanTextFiles(b, d);
      if (my !== scanSeq) return;
      scan = { state: "ready", ...got };
    } catch (e) {
      if (my !== scanSeq) return;
      const msg = messageOf(e);
      if (isSessionGone(msg)) {
        scan = { state: "idle" };
        loadState = { state: "offline", reason: "offline" };
      } else {
        scan = { state: "error", message: stripReason(msg) };
      }
    }
  }

  function setQuery(q: string) {
    const was = query.trim() !== "";
    query = q;
    active = 0;
    listScroll = 0;
    const now = q.trim() !== "";
    if (!now) {
      scanSeq += 1;
      scan = { state: "idle" };
    } else if (!was && scan.state === "idle" && !findBlocked) {
      void startScan();
    }
  }

  function openDir(path: string) {
    if (blocked) return;
    dir = path;
    query = "";
    active = 0;
    listScroll = 0;
    scanSeq += 1;
    scan = { state: "idle" };
    void load();
  }

  function up() {
    const b = host.backend;
    if (hasParent(dir, b.parentOf)) openDir(b.parentOf(dir));
  }

  function pick(row: DocFileRow) {
    if (blocked) return;
    if (row.kind === "file") host.onpick(row.path);
    else openDir(row.path);
  }

  function move(delta: number) {
    if (delta === 0) return;
    active = moveStartSelection(items.length, activeIndex, delta < 0 ? "up" : "down");
  }

  function enter() {
    const row = activeIndex >= 0 ? items[activeIndex] : undefined;
    if (row) pick(row);
  }

  /** 질의를 비웠으면 `true` — `false` 면 부르는 쪽이 포커스를 돌린다 */
  function escape(): boolean {
    if (query === "") return false;
    setQuery("");
    return true;
  }

  function focusBody() {
    host.root()?.focus({ preventScroll: true });
  }

  function isCurrent(row: DocFileRow): boolean {
    return row.kind === "file" && samePath(row.path, host.path, host.backend.sep);
  }

  function openDrop() {
    const r = button?.getBoundingClientRect();
    if (!r) return;
    const w = Math.min(320, window.innerWidth - 16);
    const y = r.bottom + DROPDOWN_GAP;
    drop = {
      x: Math.max(8, Math.min(r.left, window.innerWidth - w - 8)),
      y,
      w,
      maxH: Math.max(160, Math.min(420, window.innerHeight - y - 8)),
    };
  }

  function closeDrop() {
    drop = null;
  }

  function escapeDrop() {
    closeDrop();
    button?.focus();
  }

  function snapshot(): DocFilesSeed {
    return {
      key: host.backend.key,
      dir,
      query,
      active,
      browse,
      browseFor,
      ready: loadState.state === "ready" && browseFor === dir,
      scan,
      scanFor,
      scrollTop: listScroll,
    };
  }

  function dispose() {
    listSeq += 1;
    scanSeq += 1;
  }

  return {
    /** 합성 루트면 `""` */
    get dir() {
      return dir;
    },
    get dirName() {
      return dirName;
    },
    get status() {
      return status;
    },
    get blocked() {
      return blocked;
    },
    get rows() {
      return browse.rows;
    },
    get more() {
      return browse.more;
    },
    get query() {
      return query;
    },
    set query(v: string) {
      setQuery(v);
    },
    get searching() {
      return searching;
    },
    get scan() {
      return scan;
    },
    get hits() {
      return hits;
    },
    get items() {
      return items;
    },
    /** 없으면 `-1` */
    get active() {
      return activeIndex;
    },
    set active(v: number) {
      active = v;
    },
    get findBlocked() {
      return findBlocked;
    },
    get drop() {
      return drop;
    },
    get button() {
      return button;
    },
    set button(v: HTMLButtonElement | null) {
      button = v;
    },
    get listScroll() {
      return listScroll;
    },
    set listScroll(v: number) {
      listScroll = v;
    },
    load,
    snapshot,
    openDir,
    up,
    pick,
    setQuery,
    move,
    enter,
    escape,
    focusBody,
    isCurrent,
    openDrop,
    closeDrop,
    escapeDrop,
    dispose,
  };
}

export type DocFilesController = ReturnType<typeof createDocFiles>;
