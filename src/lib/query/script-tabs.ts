/**
 * **쿼리 타일의 스크립트 탭**(10-14 — Beekeeper Studio 식 [쿼리 1 ●] [쿼리 2] [+]) — 화면 규칙. 순수.
 *
 * - 탭은 **편집기 글만** 가른다. 연결 · 쓰기 모드 · 자동 커밋 · 트랜잭션 작업은 **연결 하나에 하나**라 모든 탭이 같이 쓴다(실행 줄의
 *   상태 표시는 탭을 바꿔도 같다). 결과 · 편집기 거터 표시는 탭마다 따로(`QueryView` 가 탭 번호로 들고 있다 — 저장하지 않는다).
 * - 저장 모양은 `session/spec` 의 `canonQueryTabs` 하나가 고른다 — 여기서는 화면이 쥔 **살아 있는 글**(`text`)과 저장된 초안을
 *   나란히 들고, 고칠 때마다 저장 모양(`toScripts`)으로 내려 보낸다(디바운스는 부르는 쪽).
 * - 탭 번호 `n` 은 타일 안에서 겹치지 않고 다시 쓰지 않는다(새 탭 = 지금 가장 큰 번호 + 1) — 기본 이름 "쿼리 {n}" 과 결과 · 거터의
 *   열쇠다. 이름을 바꾸면 `title`.
 * - 닫으면 오른쪽 이웃, 없으면 왼쪽 이웃이 고른 탭이 된다. **마지막 탭도 닫힌다**(2026-11-13 — 빈 화면: [새 쿼리] · [SQL 파일 열기…]).
 *   빈 상태는 저장하지 않는다 — 저장 모양(`canonQueryTabs`)이 빈 줄을 기본 상태로 접어, 다시 뜨면 "쿼리 1" 하나로 시작한다.
 * - 우클릭 [다른 탭 닫기] · [오른쪽 탭 닫기](2026-11-13 — 앱 탭 줄과 같은 규칙)는 가리킨 탭을 남기고, 고른 탭이 닫히면 가리킨 탭이 고른 탭.
 * - **데이터 탭**(2026-11-10 — `data` 칸, 화면은 `query/data-tab`)도 같은 줄 · 같은 번호 규칙에 선다. 글 · 이름이 없고(이름 바꾸기 없음 ·
 *   ● 없음 · 닫을 때 묻지 않음) **객체 하나에 탭 하나**(`findDataTab` — 스키마 · 이름이 같으면 같은 탭).
 * - ● = **저장 안 된 변경** — 살아 있는 글이 명세에 적힌 초안과 다르다(디바운스 중 · 초안 상한 32 KiB 를 넘어 저장하지 못함).
 */
import {
  QUERY_SCRIPTS_MAX,
  QUERY_SCRIPT_TITLE_MAX,
  canonQueryTabs,
  storedDraft,
  type QueryDataTab,
  type QueryScript,
  type QuerySpec,
} from "$lib/session";

/** 화면이 쥔 탭 하나 — `text` 는 편집기의 지금 글 */
export interface ScriptTab {
  n: number;
  title?: string;
  text: string;
  /** 데이터 탭이면 그 객체 · 조회 조건(저장 모양 그대로) */
  data?: QueryDataTab;
}

/** 명세 → 탭들과 고른 탭(옛 단일 초안은 첫 탭 "쿼리 1") */
export function tabsFromSpec(q: Pick<QuerySpec, "sql" | "scripts" | "active">): { tabs: ScriptTab[]; active: number } {
  const c = canonQueryTabs(q);
  if (c.scripts) {
    return {
      tabs: c.scripts.map((s) =>
        s.data ? { n: s.n, text: "", data: s.data } : { n: s.n, ...(s.title ? { title: s.title } : {}), text: s.sql ?? "" },
      ),
      active: c.active ?? c.scripts[0].n,
    };
  }
  return { tabs: [{ n: 1, text: c.sql ?? "" }], active: 1 };
}

/** 탭들 → 저장 모양(빈 초안 · 상한 초과는 `sql` 없이) */
export function toScripts(tabs: readonly ScriptTab[]): QueryScript[] {
  return tabs.map((x) => {
    if (x.data) return { n: x.n, data: x.data };
    const s: QueryScript = { n: x.n };
    if (x.title) s.title = x.title;
    const sql = storedDraft(x.text);
    if (sql !== undefined) s.sql = sql;
    return s;
  });
}

/** 저장된 초안(명세)에서 그 탭의 글 — 없으면 빈 글 */
export function savedText(q: Pick<QuerySpec, "sql" | "scripts" | "active">, n: number): string {
  return tabsFromSpec(q).tabs.find((x) => x.n === n)?.text ?? "";
}

/**
 * ● — 살아 있는 글이 저장된 초안과 다른가. 빈 글은 저장할 것이 없으니 "저장됨"(빈 탭에 ● 가 붙지 않게), 상한을 넘는 글은 저장되지
 * 않으니 늘 ●.
 */
export function tabDirty(tab: ScriptTab, saved: string): boolean {
  if (tab.data) return false;
  if (tab.text.trim() === "") return saved !== "";
  return storedDraft(tab.text) === undefined || tab.text !== saved;
}

/**
 * 새 탭 — 맨 뒤에 붙인다(글 · 이름 · 데이터 칸을 줄 수 있다 — [SQL 로 열기] · `.sql` 파일 열기 · 데이터 탭). 상한이면 `null`.
 * 이름은 `renameTab` 과 같이 다듬는다(비면 기본 이름).
 */
export function addTab(
  tabs: readonly ScriptTab[],
  init: { text?: string; title?: string; data?: QueryDataTab } = {},
): { tabs: ScriptTab[]; n: number } | null {
  if (tabs.length >= QUERY_SCRIPTS_MAX) return null;
  const n = tabs.reduce((m, x) => Math.max(m, x.n), 0) + 1;
  const title = (init.title ?? "").trim().slice(0, QUERY_SCRIPT_TITLE_MAX);
  const tab: ScriptTab = init.data ? { n, text: "", data: init.data } : { n, ...(title ? { title } : {}), text: init.text ?? "" };
  return { tabs: [...tabs, tab], n };
}

/** 이 객체(스키마 · 이름)의 데이터 탭 — 없으면 `null`(객체 하나에 탭 하나) */
export function findDataTab(tabs: readonly ScriptTab[], obj: { schema?: string | null; name: string }): ScriptTab | null {
  const schema = obj.schema ?? undefined;
  return tabs.find((x) => x.data && x.data.name === obj.name && (x.data.schema ?? undefined) === schema) ?? null;
}

/** 데이터 탭의 조회 조건을 바꾼다(WHERE · 정렬 · 쪽 크기) — 데이터 탭이 아니면 그대로 */
export function setTabData(tabs: readonly ScriptTab[], n: number, data: QueryDataTab): ScriptTab[] {
  return tabs.map((x) => (x.n === n && x.data ? { ...x, data } : x));
}

/** 탭이 하나도 없을 때의 "고른 탭" 번호 — 탭 번호는 1부터라 겹치지 않는다 */
export const NO_TAB = 0;

/**
 * 탭 닫기 — 없는 탭이면 `null`. 고른 탭을 닫으면 오른쪽 이웃(없으면 왼쪽)이 고른 탭, 마지막 하나였으면 빈 줄과 [`NO_TAB`]
 * (빈 화면 — 2026-11-13).
 */
export function closeTab(tabs: readonly ScriptTab[], active: number, n: number): { tabs: ScriptTab[]; active: number } | null {
  const i = tabs.findIndex((x) => x.n === n);
  if (i < 0) return null;
  const next = tabs.filter((x) => x.n !== n);
  if (next.length === 0) return { tabs: [], active: NO_TAB };
  if (active !== n) return { tabs: next, active };
  return { tabs: next, active: (next[i] ?? next[i - 1]).n };
}

/**
 * 우클릭 메뉴 **"다른 탭 닫기" · "오른쪽 탭 닫기"** 가 닫을 탭 번호 — 탭 줄 순서 그대로(앱 탭 줄의 `tabsToClose` 와 같은 규칙).
 * `others` 는 대상만 빼고 전부, `right` 는 대상 **뒤**의 탭들. 대상이 없으면 빈 배열(메뉴 항목이 꺼진다).
 */
export function tabsToCloseN(tabs: readonly ScriptTab[], n: number, which: "others" | "right"): number[] {
  const at = tabs.findIndex((x) => x.n === n);
  if (at < 0) return [];
  const picked = which === "right" ? tabs.slice(at + 1) : tabs.filter((x) => x.n !== n);
  return picked.map((x) => x.n);
}

/**
 * 여러 탭을 한 번에 닫는다 — 대상 `keep` 은 늘 남는다. 고른 탭이 닫히면(또는 `others`) `keep` 이 고른 탭이 된다(앱 탭 줄과 같다).
 * 닫을 것이 없으면 `null`.
 */
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

/** 이름 바꾸기 — 앞뒤 빈칸은 걷고 상한에서 자른다. 비면 기본 이름으로 */
export function renameTab(tabs: readonly ScriptTab[], n: number, title: string): ScriptTab[] {
  const clean = title.trim().slice(0, QUERY_SCRIPT_TITLE_MAX);
  return tabs.map((x) => {
    if (x.n !== n || x.data) return x;
    const { title: _old, ...rest } = x;
    return clean === "" ? rest : { ...rest, title: clean };
  });
}

/** 순서 바꾸기 — `n` 탭을 `to`(0 기준 자리 · 옮긴 뒤 기준)로. 범위 밖이면 끝으로 자른다 */
export function moveTab(tabs: readonly ScriptTab[], n: number, to: number): ScriptTab[] {
  const i = tabs.findIndex((x) => x.n === n);
  if (i < 0) return [...tabs];
  const rest = tabs.filter((x) => x.n !== n);
  const at = Math.max(0, Math.min(rest.length, to));
  return [...rest.slice(0, at), tabs[i], ...rest.slice(at)];
}

/** 글을 바꾼다(편집기의 지금 글) */
export function setTabText(tabs: readonly ScriptTab[], n: number, text: string): ScriptTab[] {
  return tabs.map((x) => (x.n === n && x.text !== text ? { ...x, text } : x));
}
