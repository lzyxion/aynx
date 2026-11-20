// **문서 타일의 파일 칸 상태** — 왼쪽 곁 패널 · 좁은 타일의 드롭다운이 같이 쓰는 컨트롤러(2026-11-19).
// `DocView` 가 하나 만들고(`createDocFiles` — 백엔드 · 문서 경로 · 원본 없음 · 본문 상자 · `onpick` 은 게터로) 값은 게터로 읽는다.
// `doc/outline-controller.svelte.ts` 의 짝이다.
//
// 쥐는 것: 지금 폴더(처음 = 문서의 폴더 `parentOf(path)`) · 둘러보기 줄(`folderRows`) · 목록 상태 · 질의 · 찾기 자료
// (`scanTextFiles` — 팔레트 "파일 열기…" 와 같은 갈래: 로컬 = 하위 폴더 전부 · 원격 = 두 층) · 키보드로 고른 줄 · 좁은
// 타일의 드롭다운 자리와 단추 손잡이. 줄 규칙은 순수 `doc-files.ts`, 그림은 `DocFiles.svelte`.
//
// **`$effect` 는 여기 없다** — "지금 읽어야 하는가" 는 `DocView` 가 정한다(패널이 보이거나 드롭다운이 열려 있고 폴더 ·
// `backend.key` 가 바뀌면 `load` · 넓어지면 `closeDrop`). `load` 는 지금 폴더를 읽고 늦게 온 옛 답은 번호(`seq`)로 버린다.
// 찾기 자료는 질의가 비었다가 처음 글자가 들어갈 때 한 번 훑고, 질의를 비우거나 폴더 · `backend.key` 가 바뀌면 버린다.
//
// **이 타일에서 문서를 바꾸면**(파일 칸에서 고름 — 새 명세 · 새 `DocView`) 옛 칸이 `snapshot` 으로 상태를 떠서 새 칸에 넘긴다(`host.seed` —
// `doc-swap.ts` 가 나른다 · 원본 열쇠가 같을 때만). 받은 칸은 처음 폴더 대신 그 폴더 · 줄 · 질의 · 찾기 자료 · 고른 줄 · 목록 스크롤로 선다.
// 첫 `load` 는 같은 폴더 다시 읽기라 줄을 남기고 "읽는 중" 으로 돌리지 않는다.
//
// **목록 스크롤은 여기 하나(`listScroll`)가 기억한다** — `DocFiles.svelte` 는 설 때마다(곁 패널 · 드롭다운 · 새 타일의 첫 그리기 · 드롭다운을
// 다시 열 때) 이 값으로 서고 스크롤마다 적는다. 폴더 · 질의가 바뀌면 여기서 0 으로 돌린다(새 목록은 맨 위). 한 번만 꺼내는 씨앗 값을 따로 두면
// 좁은 새 타일의 첫 프레임에 잠깐 선 곁 패널이 꺼내 가 나중에 여는 드롭다운이 0 에서 섰다(2026-11-20).
//
// 끊김(`backend.online` 거짓) · 원본 없음(`sourceGone`)이면 읽지 않고 상태만 `offline` — 마지막 목록은 남기고 줄은 막는다.
// `[session-gone]` 실패는 오류로 적지 않는다(같은 `offline`).
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

/** `DocView` 가 넘기는 값 — 값은 **게터**라 그때그때의 값이다(생성 시점 사본이 아니다) */
export interface DocFilesHost {
  readonly backend: FsBackend;
  /** 지금 문서의 경로 — 처음 폴더 · 지금 문서 줄 강조 */
  readonly path: string;
  /** 원본 터미널이 없다(원격 문서) — 읽지 않는다 */
  readonly sourceGone: boolean;
  /** 본문 상자 — 패널의 빈 칸 Esc 가 포커스를 돌려줄 자리 */
  root(): HTMLElement | null;
  /** 파일 줄을 골랐다 — 지금 문서와 같아도 그대로 올린다("지금 문서를 다시 고름" 은 app 층이 가른다) */
  onpick(path: string): void;
  /**
   * 이 타일에서 문서를 바꾸며 옛 파일 칸이 넘긴 상태(`doc-swap.ts` — 생성 때 한 번 읽는 값이라 게터가 아니다). 원본(`backend.key`)이 같을
   * 때만 받는다(`acceptFilesSeed`)
   */
  readonly seed?: DocFilesSeed | null;
}

/** 목록 한 줄 — 둘러보기 줄 그대로, 찾기 결과면 `sub` 에 흐린 상대 폴더(뿌리 바로 아래면 `""`) */
export type DocFilesItem = DocFileRow & { sub?: string };

/** 폴더 목록의 상태 — `offline` 의 `reason` 은 문구 갈래(끊김 · 원본 없음) */
export type DocFilesStatus =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ready" }
  | { state: "offline"; reason: "offline" | "gone" };

const NO_ROWS: FolderRows = { rows: [], more: 0 };

/** 실패 문구 — 이유 코드는 떼고 사람 말만 */
function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** 파일 칸 하나를 만든다 — 상태는 이 안에 살고 읽기는 게터로 */
export function createDocFiles(host: DocFilesHost) {
  // 넘겨받은 상태가 있으면 그 자리에서 선다 — 폴더 · 줄 · 질의 · 찾기 자료 · 고른 줄 · 스크롤(첫 읽기는 줄을 남긴 채 같은 폴더를 다시 읽는다)
  const seed = acceptFilesSeed(host.seed, host.backend.key);
  let dir = $state(seed ? seed.dir : host.backend.parentOf(host.path));
  /** 둘러보기 줄 — 상자가 크고 통째로 바뀌므로 깊은 반응형을 두지 않는다 */
  let browse = $state.raw<FolderRows>(seed ? seed.browse : NO_ROWS);
  /** `browse` 가 어느 폴더의 것인가 — 다른 폴더를 읽기 시작하면 비운다(같은 폴더 다시 읽기는 남긴다) */
  let browseFor: string | null = seed ? seed.browseFor : null;
  let loadState = $state<DocFilesStatus>(seed?.ready ? { state: "ready" } : { state: "loading" });
  let query = $state(seed ? seed.query : "");
  let scan = $state.raw<DocFilesScan>(seed ? seed.scan : { state: "idle" });
  /** `scan` 이 어느 원본 · 폴더의 것인가 */
  let scanFor = seed ? seed.scanFor : "";
  let active = $state(seed ? seed.active : 0);
  /**
   * 목록 상자의 스크롤 — `DocFiles.svelte` 가 설 때 이 값으로 서고 스크롤마다 적는다. 폴더 · 질의가 바뀌면 0(`openDir` · `setQuery`).
   * 인계 사본 `snapshot` 에 싣는다 · 반응형일 필요 없다(서는 순간과 폴더 · 질의 변화에만 읽힌다)
   */
  let listScroll = seed ? seed.scrollTop : 0;
  let listSeq = 0;
  let scanSeq = 0;

  /** 좁은 타일의 파일 드롭다운 자리(단추 아래) — `null` 이면 닫힘 */
  let drop = $state<{ x: number; y: number; w: number; maxH: number } | null>(null);
  let button = $state<HTMLButtonElement | null>(null);

  const forKey = () => `${host.backend.key}\n${dir}`;

  /** 읽을 수 없다 — 끊김 · 원본 없음 */
  const blocked = $derived(!host.backend.online || host.sourceGone);
  const status = $derived<DocFilesStatus>(
    host.sourceGone
      ? { state: "offline", reason: "gone" }
      : !host.backend.online
        ? { state: "offline", reason: "offline" }
        : loadState,
  );
  /** 합성 루트("내 PC")에서는 찾지 않는다 */
  const findBlocked = $derived(host.backend.isSyntheticRoot(dir));
  const searching = $derived(query.trim() !== "" && !findBlocked);
  /** 지금 폴더 줄의 글 — 빵부스러기 마지막 조각(합성 루트면 그 이름) */
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
  /** 지금 목록 — 찾는 중이면 찾기 결과, 아니면 둘러보기 줄 */
  const items = $derived<DocFilesItem[]>(searching ? hits : browse.rows);
  const activeIndex = $derived(items.length === 0 ? -1 : Math.min(Math.max(0, active), items.length - 1));

  /** 지금 폴더를 읽는다 — 끊겼으면 읽지 않는다(상태는 `status` 가 `offline` 으로 말한다) */
  async function load(): Promise<void> {
    const my = ++listSeq;
    const key = forKey();
    // 원본 · 폴더가 바뀌었으면 찾기 자료는 옛것 — 버리고, 질의가 남아 있으면 새로 훑는다(끊김으로 놓친 훑기도)
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
    // 다른 폴더의 줄은 비운다 — 같은 폴더 다시 읽기(재연결 포함)는 남긴 채 갈아 끼운다. 줄이 다 서 있던 다시 읽기는 "읽는 중" 으로 돌리지
    // 않는다 — 문서를 바꿔 넘겨받은 칸의 첫 읽기에서 빈 폴더 문구(`..` 아래)가 꺼졌다 켜지며 깜빡였다
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

  /** 지금 폴더에서 하위 폴더까지 훑는다(찾기 자료) */
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

  /** 질의를 바꾼다 — 비었다가 처음 글자가 들어가면 훑고, 비우면 찾기 자료를 버린다. 고른 줄은 첫 줄로 · 목록은 맨 위로 */
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

  /** 폴더를 바꾼다 — 질의 · 찾기 자료를 비우고 그 폴더를 읽는다(목록은 맨 위로) */
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

  /** 상위 폴더로 — 꼭대기면 그대로 */
  function up() {
    const b = host.backend;
    if (hasParent(dir, b.parentOf)) openDir(b.parentOf(dir));
  }

  /** 줄 하나를 골랐다 — `..` · 폴더는 그 자리에서 들어가고, 파일은 `host.onpick` 으로 올린다 */
  function pick(row: DocFileRow) {
    if (blocked) return;
    if (row.kind === "file") host.onpick(row.path);
    else openDir(row.path);
  }

  /** ↑↓ 한 칸 — 감싸지 않는다(`moveStartSelection`) */
  function move(delta: number) {
    if (delta === 0) return;
    active = moveStartSelection(items.length, activeIndex, delta < 0 ? "up" : "down");
  }

  /** Enter — 고른 줄을 고른다 */
  function enter() {
    const row = activeIndex >= 0 ? items[activeIndex] : undefined;
    if (row) pick(row);
  }

  /** Esc — 질의가 있으면 비우고 `true`. 없으면 `false`(부르는 쪽이 본문 · 단추로 포커스를 돌린다) */
  function escape(): boolean {
    if (query === "") return false;
    setQuery("");
    return true;
  }

  /** 본문으로 포커스(패널의 빈 칸 Esc) */
  function focusBody() {
    host.root()?.focus({ preventScroll: true });
  }

  /** 지금 문서의 줄인가 */
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

  /** Esc — 닫고 단추로 돌아간다(바깥 클릭 닫기는 포커스를 옮기지 않는다) */
  function escapeDrop() {
    closeDrop();
    button?.focus();
  }

  /** 이 타일에서 문서를 바꿀 때 새 칸에 넘길 사본(`doc-files.ts` 의 `DocFilesSeed` — 원본 열쇠를 함께 싣는다) */
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

  /** 언마운트 — 늦게 오는 답을 버린다 */
  function dispose() {
    listSeq += 1;
    scanSeq += 1;
  }

  return {
    /** 지금 폴더(절대 경로 · 합성 루트면 `""`) */
    get dir() {
      return dir;
    },
    get dirName() {
      return dirName;
    },
    get status() {
      return status;
    },
    /** 읽을 수 없어 줄을 막는다 */
    get blocked() {
      return blocked;
    },
    /** 둘러보기 줄 · 상한에 걸린 줄 수 */
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
    /** 질의가 있고 찾을 수 있는 폴더다 — 목록이 찾기 결과다 */
    get searching() {
      return searching;
    },
    get scan() {
      return scan;
    },
    get hits() {
      return hits;
    },
    /** 지금 그리는 목록(찾기 결과 또는 둘러보기 줄) */
    get items() {
      return items;
    },
    /** 키보드로 고른 줄 — `items` 의 자리, 없으면 `-1` */
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
    /** 좁은 타일의 드롭다운 단추(`bind:this`) */
    get button() {
      return button;
    },
    set button(v: HTMLButtonElement | null) {
      button = v;
    },
    /** 목록 상자의 스크롤(px) — `DocFiles.svelte` 가 설 때 이 값으로 서고 스크롤마다 적는다 */
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
