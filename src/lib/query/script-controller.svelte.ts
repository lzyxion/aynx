// **쿼리 타일의 스크립트 탭 상태** — `QueryView.svelte` 에서 그대로 옮긴 컨트롤러(2026-10-27 분할 6차).
// `QueryView` 가 하나 만들고(`createScriptTabs` — 타일 명세 · 편집기 손잡이 · 끝났나는 게터로) 값은 게터로 읽는다.
//
// 쥐는 것: 탭 목록 · 고른 탭 · 저장 디바운스(`noteQueryTabs` — 800ms) · 고르기 · 새 탭 · 닫기(글이 있으면 확인) · 이름 바꾸기 ·
// 끌어서 순서 · 탭 줄 키. 규칙은 순수 `query/script-tabs`, 그림은 `query/ScriptTabs.svelte`.
//
// `$effect` · 리스너는 없다. **연결 · 실행 · 트랜잭션 · 결과(`outcomes`) · 알림(`notes`)은 `QueryView` 에 있다** — 탭을 닫을 때 그 탭의
// 결과 · 알림을 걷는 일은 부모의 `dropResults(n)` 를 원래 자리(편집기 문서 버리기 뒤 · 저장 앞)에서 부른다.
// 언마운트의 남은 저장은 부모의 `onDestroy` 가 `flushPending()` 으로 원래 자리에서 부른다.
import { askConfirm } from "$lib/app/confirm-dialog.svelte.js";
import { noteQueryTabs } from "$lib/app/query.svelte.js";
import { t } from "$lib/i18n/i18n.svelte.js";
import { toast } from "$lib/toast.svelte.js";
import { QUERY_SCRIPTS_MAX, type PaneSpec } from "$lib/session";
import {
  addTab,
  closeTab,
  moveTab,
  renameTab,
  savedText,
  setTabText,
  tabDirty,
  tabsFromSpec,
  toScripts,
  type ScriptTab,
} from "$lib/query/script-tabs";

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
  const activeTab = $derived(tabs.find((x) => x.n === activeN) ?? tabs[0]);
  const tabLabel = (x: ScriptTab) => x.title ?? t("pane.query.tab.name", { n: x.n });

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

  function newTab() {
    const r = addTab(tabs);
    if (!r) {
      toast.info(t("pane.query.tab.full", { n: QUERY_SCRIPTS_MAX }));
      return;
    }
    tabs = r.tabs;
    pickTab(r.n);
    h.editor?.focus();
  }

  async function closeTabN(n: number) {
    const x = tabs.find((y) => y.n === n);
    if (!x || tabs.length <= 1) return;
    const text = h.editor?.textOf(docKey(n)) ?? x.text;
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

  // 이름 바꾸기(두 번 누르기 · F2)
  let renaming = $state<number | null>(null);
  let renameText = $state("");
  function startRename(n: number) {
    const x = tabs.find((y) => y.n === n);
    if (!x) return;
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
      h.editor?.focus();
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
    dirtyOf,
    flushTabs,
    flushPending,
    onDraft,
    pickTab,
    newTab,
    closeTabN,
    startRename,
    endRename,
    tabDragStart,
    tabDragOver,
    tabDrop,
    onTabKey,
  };
}

export type ScriptTabsController = ReturnType<typeof createScriptTabs>;
