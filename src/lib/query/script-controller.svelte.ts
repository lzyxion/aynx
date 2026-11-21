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

export interface ScriptTabsEditor {
  switchTo(key: string, text: string): void;
  textOf(key: string): string | null;
  dropDoc(key: string): void;
  focus(): void;
}

/** **게터**라 그때그때의 값이다(생성 시점 사본이 아니다). */
export interface ScriptTabsHost {
  readonly pane: PaneSpec;
  /** 이 타일의 영속 키(`tileKey`) — 끌기 데이터가 다른 타일의 탭과 섞이지 않게 */
  readonly stream: string;
  readonly editor: ScriptTabsEditor | null;
  readonly disposed: boolean;
  dropResults(n: number): void;
}

export const docKey = (n: number) => String(n);

export function createScriptTabs(h: ScriptTabsHost) {
  const initTabs = tabsFromSpec(h.pane.query ?? {});
  let tabs = $state<ScriptTab[]>(initTabs.tabs);
  let activeN = $state(initTabs.active);
  const activeTab = $derived<ScriptTab | null>(tabs.find((x) => x.n === activeN) ?? tabs[0] ?? null);
  const tabLabel = (x: ScriptTab) => (x.data ? x.data.name : (x.title ?? t("pane.query.tab.name", { n: x.n })));

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

  /** 포커스는 `tick` 뒤에 — 데이터 탭 · 빈 화면에서 오면 편집기가 아직 `display: none`(`.gone`)이라 포커스가 들어가지 않는다 */
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

  /** 바깥이 조건을 덮은 데이터 탭의 회차 — `DataTab` 의 `poke`. 저장하지 않는다 */
  let dataPokes = $state<Record<number, number>>({});

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

  function openFile(title: string | undefined, text: string): boolean {
    const r = addTab(tabs, { text, ...(title ? { title } : {}) });
    if (!r) return false;
    tabs = r.tabs;
    pickTab(r.n);
    focusEditor();
    return true;
  }

  function liveText(n: number): string | null {
    const x = tabs.find((y) => y.n === n);
    if (!x || x.data) return null;
    return h.editor?.textOf(docKey(n)) ?? x.text;
  }

  function setData(n: number, data: QueryDataTab) {
    tabs = setTabData(tabs, n, data);
    flushTabs();
  }

  async function closeTabN(n: number) {
    const x = tabs.find((y) => y.n === n);
    if (!x) return;
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

  /** 글이 있는 탭이 있으면 한 번만 묻고, 취소하면 하나도 닫지 않는다. 묻는 동안 바뀐 탭 줄은 닫기 직전에 다시 고른다 */
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

  /** Delete 키로는 닫지 않는다 — 닫기는 확인이 있는 Ctrl+W · × */
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
    get renaming() {
      return renaming;
    },
    get renameText() {
      return renameText;
    },
    set renameText(v: string) {
      renameText = v;
    },
    tabLabel,
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
