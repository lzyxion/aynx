/**
 * 탭은 편집기 글만 가른다 — 연결 · 쓰기 모드 · 자동 커밋 · 트랜잭션 작업은 연결 하나에 하나라 모든 탭이 같이 쓴다.
 * 탭 번호 `n` 은 타일 안에서 다시 쓰지 않는다 — 기본 이름 "쿼리 {n}" 과 결과 · 거터의 열쇠다.
 */
import {
  QUERY_SCRIPTS_MAX,
  QUERY_SCRIPT_TITLE_MAX,
  canonQueryTabs,
  storedDraft,
  type QueryDataTab,
  type QueryListTab,
  type QueryScript,
  type QuerySpec,
} from "$lib/session";

/** `data` · `list` 는 배타 — 둘 다 없으면 SQL 을 쓰는 스크립트 탭 */
export interface ScriptTab {
  n: number;
  title?: string;
  text: string;
  data?: QueryDataTab;
  list?: QueryListTab;
}

/** 편집기 · 이름 · 저장 · 닫기 확인이 있는 탭(데이터 탭 · 객체 목록 탭이 아님) */
export function isScriptTab(x: Pick<ScriptTab, "data" | "list">): boolean {
  return !x.data && !x.list;
}

export function tabsFromSpec(q: Pick<QuerySpec, "sql" | "scripts" | "active">): { tabs: ScriptTab[]; active: number } {
  const c = canonQueryTabs(q);
  if (c.scripts) {
    return {
      tabs: c.scripts.map((s) =>
        s.data
          ? { n: s.n, text: "", data: s.data }
          : s.list
            ? { n: s.n, text: "", list: s.list }
            : { n: s.n, ...(s.title ? { title: s.title } : {}), text: s.sql ?? "" },
      ),
      active: c.active ?? c.scripts[0].n,
    };
  }
  return { tabs: [{ n: 1, text: c.sql ?? "" }], active: 1 };
}

export function toScripts(tabs: readonly ScriptTab[]): QueryScript[] {
  return tabs.map((x) => {
    if (x.data) return { n: x.n, data: x.data };
    if (x.list) return { n: x.n, list: x.list };
    const s: QueryScript = { n: x.n };
    if (x.title) s.title = x.title;
    const sql = storedDraft(x.text);
    if (sql !== undefined) s.sql = sql;
    return s;
  });
}

export function savedText(q: Pick<QuerySpec, "sql" | "scripts" | "active">, n: number): string {
  return tabsFromSpec(q).tabs.find((x) => x.n === n)?.text ?? "";
}

/** 빈 글은 "저장됨"(빈 탭에 ● 가 붙지 않게), 상한을 넘는 글은 저장되지 않으니 늘 ● */
export function tabDirty(tab: ScriptTab, saved: string): boolean {
  if (!isScriptTab(tab)) return false;
  if (tab.text.trim() === "") return saved !== "";
  return storedDraft(tab.text) === undefined || tab.text !== saved;
}

/** 탭 셈(`QUERY_SCRIPTS_MAX`)은 데이터 탭 · 객체 목록 탭까지 함께 센다 */
export function addTab(
  tabs: readonly ScriptTab[],
  init: { text?: string; title?: string; data?: QueryDataTab; list?: QueryListTab } = {},
): { tabs: ScriptTab[]; n: number } | null {
  if (tabs.length >= QUERY_SCRIPTS_MAX) return null;
  const n = tabs.reduce((m, x) => Math.max(m, x.n), 0) + 1;
  const title = (init.title ?? "").trim().slice(0, QUERY_SCRIPT_TITLE_MAX);
  const tab: ScriptTab = init.data
    ? { n, text: "", data: init.data }
    : init.list
      ? { n, text: "", list: init.list }
      : { n, ...(title ? { title } : {}), text: init.text ?? "" };
  return { tabs: [...tabs, tab], n };
}

/** 스키마 하나에 목록 탭 하나 */
export function findListTab(tabs: readonly ScriptTab[], schema: string): ScriptTab | null {
  return tabs.find((x) => x.list && x.list.schema === schema) ?? null;
}

export function setTabList(tabs: readonly ScriptTab[], n: number, list: QueryListTab): ScriptTab[] {
  return tabs.map((x) => (x.n === n && x.list ? { ...x, list } : x));
}

export function findDataTab(tabs: readonly ScriptTab[], obj: { schema?: string | null; name: string }): ScriptTab | null {
  const schema = obj.schema ?? undefined;
  return tabs.find((x) => x.data && x.data.name === obj.name && (x.data.schema ?? undefined) === schema) ?? null;
}

export function setTabData(tabs: readonly ScriptTab[], n: number, data: QueryDataTab): ScriptTab[] {
  return tabs.map((x) => (x.n === n && x.data ? { ...x, data } : x));
}

/** 탭이 하나도 없을 때의 "고른 탭" 번호 — 탭 번호는 1부터라 겹치지 않는다 */
export const NO_TAB = 0;

export function closeTab(tabs: readonly ScriptTab[], active: number, n: number): { tabs: ScriptTab[]; active: number } | null {
  const i = tabs.findIndex((x) => x.n === n);
  if (i < 0) return null;
  const next = tabs.filter((x) => x.n !== n);
  if (next.length === 0) return { tabs: [], active: NO_TAB };
  if (active !== n) return { tabs: next, active };
  return { tabs: next, active: (next[i] ?? next[i - 1]).n };
}

export function tabsToCloseN(tabs: readonly ScriptTab[], n: number, which: "others" | "right"): number[] {
  const at = tabs.findIndex((x) => x.n === n);
  if (at < 0) return [];
  const picked = which === "right" ? tabs.slice(at + 1) : tabs.filter((x) => x.n !== n);
  return picked.map((x) => x.n);
}

export function closeTabsN(
  tabs: readonly ScriptTab[],
  active: number,
  keep: number,
  ns: readonly number[],
): { tabs: ScriptTab[]; active: number } | null {
  if (!tabs.some((x) => x.n === keep)) return null;
  const drop = new Set(ns.filter((m) => m !== keep));
  const next = tabs.filter((x) => !drop.has(x.n));
  if (next.length === tabs.length) return null;
  return { tabs: next, active: next.some((x) => x.n === active) ? active : keep };
}

export function renameTab(tabs: readonly ScriptTab[], n: number, title: string): ScriptTab[] {
  const clean = title.trim().slice(0, QUERY_SCRIPT_TITLE_MAX);
  return tabs.map((x) => {
    if (x.n !== n || !isScriptTab(x)) return x;
    const { title: _old, ...rest } = x;
    return clean === "" ? rest : { ...rest, title: clean };
  });
}

/** `to` = 옮긴 뒤 기준 자리(0 기준) */
export function moveTab(tabs: readonly ScriptTab[], n: number, to: number): ScriptTab[] {
  const i = tabs.findIndex((x) => x.n === n);
  if (i < 0) return [...tabs];
  const rest = tabs.filter((x) => x.n !== n);
  const at = Math.max(0, Math.min(rest.length, to));
  return [...rest.slice(0, at), tabs[i], ...rest.slice(at)];
}

export function setTabText(tabs: readonly ScriptTab[], n: number, text: string): ScriptTab[] {
  return tabs.map((x) => (x.n === n && x.text !== text ? { ...x, text } : x));
}
