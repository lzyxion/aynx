// **쿼리 타일의 스크립트 탭 상태** — `QueryView.svelte` 에서 그대로 옮긴 컨트롤러(2026-10-27 분할 6차).
// `QueryView` 가 하나 만들고(`createScriptTabs` — 타일 명세 · 편집기 손잡이 · 끝났나는 게터로) 값은 게터로 읽는다.
//
// 쥐는 것: 탭 목록 · 고른 탭 · 저장 디바운스(`noteQueryTabs` — 800ms) · 고르기 · 새 탭 · 닫기(글이 있으면 확인) · 이름 바꾸기 ·
// 끌어서 순서 · 탭 줄 키. 규칙은 순수 `query/script-tabs`, 그림은 `query/ScriptTabs.svelte`.
//
// `$effect` · 리스너는 없다. **연결 · 실행 · 트랜잭션 · 결과(`outcomes`) · 알림(`notes`)은 `QueryView` 에 있다** — 탭을 닫을 때 그 탭의
// 결과 · 알림을 걷는 일은 부모의 `dropResults(n)` 를 원래 자리(편집기 문서 버리기 뒤 · 저장 앞)에서 부른다.
// 언마운트의 남은 저장은 부모의 `onDestroy` 가 `flushPending()` 으로 원래 자리에서 부른다.
import { tick } from "svelte";
import { askConfirm } from "$lib/app/confirm-dialog.svelte.js";
import { noteQueryTabs } from "$lib/app/query.svelte.js";
import { t } from "$lib/i18n/i18n.svelte.js";
import { toast } from "$lib/toast.svelte.js";
import { QUERY_SCRIPTS_MAX, type PaneSpec, type QueryDataTab } from "$lib/session";
import {
  addTab,
  closeTab,
  closeTabsN,
  findDataTab,
  tabsToCloseN,
  setTabData,
  moveTab,
  renameTab,
  savedText,
  setTabText,
  tabDirty,
  tabsFromSpec,
  toScripts,
  type ScriptTab,
} from "$lib/query/script-tabs";
import { withWhere } from "$lib/query/data-tab";

/** 탭을 바꿔 끼우는 편집기 — `query/SqlEditor.svelte` 의 손잡이 중 탭이 쓰는 것 */
export interface ScriptTabsEditor {
  switchTo(key: string, text: string): void;
  textOf(key: string): string | null;
  dropDoc(key: string): void;
  focus(): void;
}

/** `QueryView` 가 넘기는 값 — **게터**라 그때그때의 값이다(생성 시점 사본이 아니다). */
export interface ScriptTabsHost {
  readonly pane: PaneSpec;
  /** 이 타일의 영속 키(`tileKey`) — 끌기 데이터가 다른 타일의 탭과 섞이지 않게 */
  readonly stream: string;
  readonly editor: ScriptTabsEditor | null;
  /** 컴포넌트가 사라졌나(확인 상자를 기다리는 사이) */
  readonly disposed: boolean;
  /** 닫은 탭의 결과 · 알림을 걷는다(부모 상태) */
  dropResults(n: number): void;
}

/** 편집기 글의 열쇠 — 탭 번호 */
export const docKey = (n: number) => String(n);

/** 스크립트 탭 하나 벌을 만든다 — 상태는 이 안에 살고 읽기는 게터로 */
export function createScriptTabs(h: ScriptTabsHost) {
  const initTabs = tabsFromSpec(h.pane.query ?? {});
  let tabs = $state<ScriptTab[]>(initTabs.tabs);
  let activeN = $state(initTabs.active);
  /** 고른 탭 — 탭이 하나도 없으면(빈 화면) `null` */
  const activeTab = $derived<ScriptTab | null>(tabs.find((x) => x.n === activeN) ?? tabs[0] ?? null);
  // 데이터 탭은 객체 이름(스키마는 말풍선 — `ScriptTabs`)
  const tabLabel = (x: ScriptTab) => (x.data ? x.data.name : (x.title ?? t("pane.query.tab.name", { n: x.n })));

  /** 탭 · 초안 저장(디바운스 — 고칠 때마다) */
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  function flushTabs() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = null;
    if (h.pane.query) noteQueryTabs(h.pane.id, toScripts(tabs), activeN);
  }
  function saveTabsSoon() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(flushTabs, 800);
  }
  /** 언마운트 — 미뤄 둔 저장이 있으면 지금 한다 */
  function flushPending() {
    if (saveTimer) flushTabs();
  }
  function onDraft(text: string) {
    tabs = setTabText(tabs, activeN, text);
    saveTabsSoon();
  }
  const dirtyOf = (x: ScriptTab) => tabDirty(x, savedText(h.pane.query ?? {}, x.n));

  function pickTab(n: number) {
    if (n === activeN || !tabs.some((x) => x.n === n)) return;
    const next = tabs.find((x) => x.n === n)!;
    activeN = n;
    h.editor?.switchTo(docKey(n), next.text);
    flushTabs();
  }

  /**
   * 편집기로 포커스 — **화면이 바뀐 뒤에**(`tick`). 데이터 탭 · 빈 화면에서 오면 이 순간 편집기는 아직 `display: none`(`.gone`)이라
   * 곧바로 `focus()` 하면 포커스가 들어가지 않는다(11-13 — 새 탭에 바로 쓸 수 없던 까닭).
   */
  function focusEditor() {
    void tick().then(() => {
      if (!h.disposed) h.editor?.focus();
    });
  }

  function newTab() {
    const r = addTab(tabs);
    if (!r) {
      toast.info(t("pane.query.tab.full", { n: QUERY_SCRIPTS_MAX }));
      return;
    }
    tabs = r.tabs;
    pickTab(r.n);
    focusEditor();
  }

  /**
   * **데이터 탭 열기**(트리의 두 번 누르기 · Enter · 우클릭 "데이터 보기") — 객체 하나에 탭 하나: 이미 있으면 그 탭으로 가고, 없으면 맨 뒤에
   * 새로(조건은 비어서 시작). 상한이면 알림.
   */
  function openData(obj: Pick<QueryDataTab, "kind" | "schema" | "name">) {
    const have = findDataTab(tabs, obj);
    if (have) {
      pickTab(have.n);
      return;
    }
    const r = addTab(tabs, { data: { kind: obj.kind, ...(obj.schema !== undefined ? { schema: obj.schema } : {}), name: obj.name } });
    if (!r) {
      toast.info(t("pane.query.tab.full", { n: QUERY_SCRIPTS_MAX }));
      return;
    }
    tabs = r.tabs;
    pickTab(r.n);
  }

  /** 바깥이 조건을 덮은 데이터 탭의 회차(탭 번호 → 수) — `DataTab` 의 `poke`. 저장하지 않는다 */
  let dataPokes = $state<Record<number, number>>({});

  /**
   * **외래 키 따라가기**(결과 표의 ↗ · 칸 메뉴 [<표> 에서 보기]) — 그 표의 데이터 탭을 이 조건으로. 이미 열려 있으면 그 탭으로 가서 조건을
   * 덮고 다시 읽게 하고(`dataPokes`), 없으면 그 조건으로 새 탭(정렬 · 쪽 크기는 기본). 조건은 명세에 남는다(`withWhere` — 사람이 친 조건과 같다).
   */
  function openDataWhere(obj: { schema: string | null; name: string }, where: string) {
    const have = findDataTab(tabs, obj);
    if (have?.data) {
      tabs = setTabData(tabs, have.n, withWhere(have.data, where));
      flushTabs();
      dataPokes = { ...dataPokes, [have.n]: (dataPokes[have.n] ?? 0) + 1 };
      pickTab(have.n);
      return;
    }
    const base: QueryDataTab = { kind: "table", ...(obj.schema !== null ? { schema: obj.schema } : {}), name: obj.name };
    const r = addTab(tabs, { data: withWhere(base, where) });
    if (!r) {
      toast.info(t("pane.query.tab.full", { n: QUERY_SCRIPTS_MAX }));
      return;
    }
    tabs = r.tabs;
    pickTab(r.n);
  }

  /** 새 쿼리 탭에 글을 넣어 연다(데이터 탭의 [SQL 로 열기] · DDL 의 [편집기에 넣기]) — 실행하지 않는다 */
  function openSql(text: string) {
    const r = addTab(tabs, { text });
    if (!r) {
      toast.info(t("pane.query.tab.full", { n: QUERY_SCRIPTS_MAX }));
      return;
    }
    tabs = r.tabs;
    pickTab(r.n);
    focusEditor();
  }

  /**
   * `.sql` 파일을 새 쿼리 탭으로 연다(끌어 놓기 · [SQL 파일 열기…] · `Ctrl+O` — `query/sql-file-io`) — 실행하지 않는다. 탭 상한이면 `false`
   * (알림은 부르는 쪽 — 남은 파일 수를 말한다). 탭은 파일 경로를 기억하지 않는다.
   */
  function openFile(title: string | undefined, text: string): boolean {
    const r = addTab(tabs, { text, ...(title ? { title } : {}) });
    if (!r) return false;
    tabs = r.tabs;
    pickTab(r.n);
    focusEditor();
    return true;
  }

  /** 탭의 지금 글 — 고른 탭이면 편집기의 살아 있는 글, 아니면 탭이 쥔 글(데이터 탭은 `null`) */
  function liveText(n: number): string | null {
    const x = tabs.find((y) => y.n === n);
    if (!x || x.data) return null;
    return h.editor?.textOf(docKey(n)) ?? x.text;
  }

  /** 데이터 탭의 조회 조건(WHERE · 정렬 · 쪽 크기)이 바뀌었다 — 곧바로 저장 */
  function setData(n: number, data: QueryDataTab) {
    tabs = setTabData(tabs, n, data);
    flushTabs();
  }

  async function closeTabN(n: number) {
    const x = tabs.find((y) => y.n === n);
    if (!x) return;
    // 데이터 탭은 잃을 글이 없다 — 묻지 않는다
    const text = x.data ? "" : (h.editor?.textOf(docKey(n)) ?? x.text);
    if (text.trim() !== "") {
      let ok = false;
      try {
        ok = await askConfirm(t("pane.query.tab.confirm.body", { name: tabLabel(x) }), {
          title: t("pane.query.tab.confirm.title"),
          kind: "warning",
          okLabel: t("pane.query.tab.confirm.ok"),
          cancelLabel: t("pane.query.tab.confirm.cancel"),
          danger: true,
        });
      } catch {
        ok = false;
      }
      if (!ok || h.disposed) return;
    }
    const r = closeTab(tabs, activeN, n);
    if (!r) return;
    const wasActive = n === activeN;
    tabs = r.tabs;
    if (wasActive) {
      activeN = r.active;
      h.editor?.switchTo(docKey(r.active), tabs.find((y) => y.n === r.active)?.text ?? "");
    }
    h.editor?.dropDoc(docKey(n));
    h.dropResults(n);
    flushTabs();
  }

  /**
   * 우클릭 [다른 탭 닫기] · [오른쪽 탭 닫기] — 글이 있는 탭이 하나라도 있으면 **한 번만** 묻고, 취소하면 하나도 닫지 않는다
   * (앱 탭 줄의 `closeTabsAsked` 와 같다). 묻는 동안 바뀐 탭 줄은 닫기 직전에 다시 고른다.
   */
  async function closeTabsAround(n: number, which: "others" | "right") {
    const pick = () => tabsToCloseN(tabs, n, which).map((m) => tabs.find((y) => y.n === m)!);
    const first = pick();
    if (first.length === 0) return;
    const withText = first.filter((x) => !x.data && (h.editor?.textOf(docKey(x.n)) ?? x.text).trim() !== "");
    if (withText.length > 0) {
      let ok = false;
      try {
        ok = await askConfirm(
          withText.length === 1
            ? t("pane.query.tab.confirm.body", { name: tabLabel(withText[0]) })
            : t("pane.query.tab.confirm.many.body", { n: withText.length }),
          {
            title: t(withText.length === 1 ? "pane.query.tab.confirm.title" : "pane.query.tab.confirm.many.title"),
            kind: "warning",
            okLabel: t("pane.query.tab.confirm.ok"),
            cancelLabel: t("pane.query.tab.confirm.cancel"),
            danger: true,
          },
        );
      } catch {
        ok = false;
      }
      if (!ok || h.disposed) return;
    }
    const ns = pick().map((x) => x.n);
    const r = closeTabsN(tabs, activeN, n, ns);
    if (!r) return;
    const wasActive = activeN;
    tabs = r.tabs;
    if (r.active !== wasActive) {
      activeN = r.active;
      h.editor?.switchTo(docKey(r.active), tabs.find((y) => y.n === r.active)?.text ?? "");
    }
    for (const m of ns) {
      h.editor?.dropDoc(docKey(m));
      h.dropResults(m);
    }
    flushTabs();
  }

  // 이름 바꾸기(두 번 누르기 · F2)
  let renaming = $state<number | null>(null);
  let renameText = $state("");
  function startRename(n: number) {
    const x = tabs.find((y) => y.n === n);
    if (!x || x.data) return;
    renaming = n;
    renameText = tabLabel(x);
  }
  function endRename(commit: boolean) {
    const n = renaming;
    renaming = null;
    if (n === null || !commit) return;
    const x = tabs.find((y) => y.n === n);
    // 기본 이름 그대로면 이름을 두지 않는다(저장 모양이 예전 그대로 남게)
    const title = x && renameText.trim() === t("pane.query.tab.name", { n }) ? "" : renameText;
    tabs = renameTab(tabs, n, title);
    flushTabs();
  }

  // 끌어서 순서 바꾸기
  const TAB_MIME = "application/x-aynx-query-tab";
  function tabDragStart(ev: DragEvent, n: number) {
    if (!ev.dataTransfer) return;
    ev.dataTransfer.setData(TAB_MIME, `${h.stream}:${n}`);
    ev.dataTransfer.effectAllowed = "move";
  }
  function tabDragOver(ev: DragEvent) {
    if (ev.dataTransfer?.types.includes(TAB_MIME)) {
      ev.preventDefault();
      ev.dataTransfer.dropEffect = "move";
    }
  }
  function tabDrop(ev: DragEvent, at: number) {
    const raw = ev.dataTransfer?.getData(TAB_MIME) ?? "";
    const prefix = `${h.stream}:`;
    if (!raw.startsWith(prefix)) return;
    ev.preventDefault();
    const n = Number(raw.slice(prefix.length));
    if (!Number.isInteger(n)) return;
    tabs = moveTab(tabs, n, at);
    flushTabs();
  }

  /** 탭 줄의 화살표(←/→ — 탭 사이) · F2(이름) · Delete 없음(닫기는 확인이 있는 Ctrl+W · ×) */
  function onTabKey(ev: KeyboardEvent, n: number) {
    if (renaming !== null) return;
    const i = tabs.findIndex((x) => x.n === n);
    if (ev.key === "ArrowLeft" || ev.key === "ArrowRight") {
      ev.preventDefault();
      const j = Math.max(0, Math.min(tabs.length - 1, i + (ev.key === "ArrowLeft" ? -1 : 1)));
      pickTab(tabs[j].n);
      (ev.currentTarget as HTMLElement).parentElement?.querySelectorAll<HTMLElement>("[role=tab]")[j]?.focus();
    } else if (ev.key === "F2") {
      ev.preventDefault();
      startRename(n);
    } else if (ev.key === "Enter" || ev.key === " ") {
      ev.preventDefault();
      pickTab(n);
      focusEditor();
    }
  }

  return {
    get tabs() {
      return tabs;
    },
    get activeN() {
      return activeN;
    },
    get activeTab() {
      return activeTab;
    },
    /** 이름을 바꾸는 탭(`null` = 없음) */
    get renaming() {
      return renaming;
    },
    /** 이름 바꾸는 칸의 글(`ScriptTabs` 가 묶는다) */
    get renameText() {
      return renameText;
    },
    set renameText(v: string) {
      renameText = v;
    },
    tabLabel,
    /** 이 데이터 탭의 바깥 덮기 회차(`openDataWhere`) */
    dataPoke: (n: number) => dataPokes[n] ?? 0,
    openDataWhere,
    dirtyOf,
    flushTabs,
    flushPending,
    onDraft,
    pickTab,
    newTab,
    openData,
    openSql,
    openFile,
    liveText,
    setData,
    closeTabN,
    closeTabsAround,
    startRename,
    endRename,
    tabDragStart,
    tabDragOver,
    tabDrop,
    onTabKey,
  };
}

export type ScriptTabsController = ReturnType<typeof createScriptTabs>;
