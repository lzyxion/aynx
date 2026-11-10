<script lang="ts">
  import { tick, untrack } from "svelte";
  import UiIcon from "$lib/UiIcon.svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { stripReason } from "$lib/error-reason";
  import { comboFromEvent, effectiveCombo } from "$lib/keybindings";
  import { settings } from "$lib/settings.svelte.js";
  import {
    dbObjects,
    dbSchema,
    dbTableDetail,
    errorMessage,
    type DbDefinitionTarget,
    type DbDialect,
    type DbObject,
    type DbObjectKind,
    type DbObjects,
    type DbTableDetail,
  } from "./query-backend";
  import { qualifiedName } from "./sql-quote";
  import {
    columnList,
    countLabel,
    findRelation,
    fkArrow,
    fkTarget,
    insertText,
    isExpandable,
    keyAction,
    leafInsertText,
    matchSpan,
    objectKey,
    relationFor,
    relationOf,
    revealKeys,
    schemaKey,
    signature,
    skipSchemaLevel,
    toggled,
    visibleRows,
    withExpanded,
    type DetailLeaf,
    type DetailPart,
    type Load,
    type TreeRelation,
    type TreeRow,
  } from "./schema-tree";
  import { definitionName, definitionTarget } from "./definition";
  import type { CatalogNote } from "./sql-completer";

  /**
   * **스키마 트리**(DBeaver 식 — 규칙은 `schema-tree.ts`). 스키마(이름만 · `db_schema`) → 펼치면 그 스키마의 객체를 한 번에
   * (`db_objects`) 읽어 종류별 폴더(테이블 · 뷰 · 함수 …, 빈 폴더 숨김 · 머리에 개수) → 관계(테이블 · 뷰 · 구체화 뷰 · 외부 테이블)를
   * 펼치면 구조를 한 번에(`db_table_detail`) 읽어 구조 폴더(컬럼 · 인덱스 · 제약 조건 · 외래 키 · 참조됨 · 트리거 · 파티션 — 빈 폴더
   * 숨김). 모두 기본 접힘이고, 펼친 열쇠 목록(`expanded`)은 타일이 쥔다 — 트리를 숨겼다 펴도 · 다시 연결해도 남는다. [새로 고침]은
   * 펼친 것을 그대로 두고 다시 읽는다.
   *
   * 누르기(2026-11-10 Beekeeper 식): 관계 · 파티션 = **한 번은 고르기만**(초점 · 관계는 펼치기/접기 — 편집기 글은 건드리지 않는다),
   * **두 번 누르기 · Enter = 그 객체의 데이터 탭**(`onopen` — 객체 하나에 탭 하나는 부르는 쪽) · 외래 키 · 참조됨 = 다른 쪽 테이블로 트리 이동(조상을 펴고
   * 고른다 — 그 스키마를 아직 안 읽었으면 읽는다) · 그 밖의 잎 = 편집기 커서 자리에 인용된 이름(`oninsert` — 함수는 여는 괄호까지).
   * **만들기 · 고치기 · 지우기 동작은 없다**(읽고 이해하는 창 — docs/user/query-tile.md "What is not built").
   * 키보드(트리 묶음이 받는다): ↑↓ · →(펼치기 / 첫 자식) · ←(접기 / 부모) · Home · End · Enter · `F4` = DDL 보기.
   * 정의가 있는 줄(`query/definition` 의 `definitionTarget`)은 우클릭하면 메뉴(`oncontext` — 그림은 부르는 쪽의 `TreeMenu`)가 뜬다.
   *
   * **이름 필터**(10-13 — 규칙은 `schema-tree` 머리말): 머리 아래 칸 · 트리에서 `Ctrl+I`(파일 타일 필터와 같은 키) · 칸에서 `Esc` 로
   * 지움(빈 칸이면 트리로) · `↓` 로 트리로. **이미 읽어 온 것만** 거른다 — 안 읽은 스키마는 맨 위 "읽지 않은 스키마 N개 · [모두 읽기]".
   * 서버 검색 op 를 두지 않은 까닭: 스키마 하나를 펴는 왕복(`db_objects`)이 이미 그 스키마의 이름을 다 가져오므로 [모두 읽기]는 스키마
   * 수만큼의 왕복이면 끝나고(그 뒤로는 타자마다 왕복 없이 거른다), 새 op 는 엔진 셋에 문장 · 상한 · 시험을 하나씩 더 늘린다. 테이블
   * 아래(컬럼 · 인덱스 …)도 그 테이블을 펼쳐 읽은 뒤에만 걸린다. 필터는 펼친 목록을 바꾸지 않는다 — 지우면 원래 펼침으로.
   *
   * 서버는 연결당 작업 하나만 받는다(Busy) — 트리의 읽기는 **줄 세워** 하나씩 보내고, 쿼리가 도는 동안(`busy`)은 읽어야 하는
   * 펼치기와 새로 고침을 막는다(이미 읽은 것을 펴고 접는 것은 된다). 실패는 트리 안 한 줄(`[stale-lease]`·`[session-gone]` 이면
   * 부르는 쪽이 [다시 열기] 로 — `onfail`).
   */
  let {
    handle,
    lease,
    dialect,
    busy,
    expanded = $bindable([]),
    reading = $bindable(false),
    onopen,
    oninsert,
    onfail,
    ondefinition,
    oncontext,
    oncatalog,
  }: {
    handle: number;
    lease: number;
    dialect: DbDialect;
    busy: boolean;
    /** 펼친 열쇠(스키마 · 폴더 · 관계 · 구조 폴더) — 타일 상태 */
    expanded?: string[];
    /** 트리가 서버에서 읽는 중인가(줄 세운 읽기가 남았나) — 데이터 탭이 그 사이에 조회를 보내지 않게(서버는 연결당 작업 하나) */
    reading?: boolean;
    /** 데이터 탭 열기(두 번 누르기 · Enter) */
    onopen: (obj: TreeRelation) => void;
    /** 편집기 커서 자리에 넣을 글자 */
    oninsert: (text: string) => void;
    /** 오류 원문(접두어 그대로) — 다시 열기 갈래는 부르는 쪽이 가른다 */
    onfail: (message: string) => void;
    /** DDL 보기(`F4` · 메뉴) — 읽기는 부르는 쪽이 한다(아래 칸의 [DDL]) */
    ondefinition: (target: DbDefinitionTarget) => void;
    /** 정의가 있는 줄의 우클릭 — 메뉴는 부르는 쪽이 타일 컨테이너 밖에 그린다 */
    oncontext: (ev: MouseEvent, target: DbDefinitionTarget, title: string, rel: TreeRelation | null) => void;
    /** 읽어 온 스키마 · 객체 · 구조 — 편집기 자동완성이 받아 둔다(`sql-completer`) */
    oncatalog?: (n: CatalogNote) => void;
  } = $props();

  let schemas = $state<string[] | null>(null);
  let loading = $state(false);
  /** [새로 고침] 아이콘이 도는가 — 읽는 동안 돌고, 빨리 끝나도 한 바퀴는 채운 뒤 바퀴 끝에서 멈춘다(브랜치 타일과 같은 규칙) */
  let spinning = $state(false);
  let error = $state<string | null>(null);
  let objects = $state<Record<string, Load<DbObjects>>>({});
  let details = $state<Record<string, Load<DbTableDetail>>>({});
  let focusKey = $state<string | null>(null);
  let rowEls = $state<HTMLElement[]>([]);
  let filter = $state("");
  let filterEl = $state<HTMLInputElement | null>(null);
  let bodyEl = $state<HTMLElement | null>(null);

  const objectMap = $derived(new Map(Object.entries(objects)));
  const rows = $derived(
    schemas
      ? visibleRows({
          dialect,
          schemas,
          expanded: new Set(expanded),
          objects: objectMap,
          details: new Map(Object.entries(details)),
          filter,
        })
      : [],
  );
  /** 키보드가 들어올 줄 — 초점 줄이 사라졌으면 첫 줄 */
  const tabKey = $derived(rows.some((r) => r.key === focusKey) ? focusKey : (rows.find((r) => r.type !== "note")?.key ?? null));

  // 서버는 연결당 작업 하나 — 트리의 읽기는 하나씩.
  let chain: Promise<unknown> = Promise.resolve();
  let inflight = 0;
  function serial<T>(f: () => Promise<T>): Promise<T> {
    inflight++;
    reading = true;
    const p = chain.then(f, f);
    const done = () => {
      inflight--;
      if (inflight === 0) reading = false;
    };
    p.then(done, done);
    chain = p.catch(() => undefined);
    return p;
  }

  function fail(e: unknown): string {
    const m = errorMessage(e);
    onfail(m);
    return stripReason(m);
  }

  // 겹침 — 연결이 열릴 때 데이터 탭 조회와 트리 읽기가 같은 순간에 출발하면 늦은 쪽이 서버의 Busy 로 실패한다(2026-11-10 실측).
  // 트리 읽기 중에 연결이 다른 일을 했으면(`busy`) 그 실패는 오류로 보이지 않고, 그 일이 끝나면 처음부터 다시 읽는다.
  let busyHit = false;
  let pendingLoad = $state(false);
  $effect(() => {
    if (busy && loading) busyHit = true;
  });
  $effect(() => {
    if (!busy && pendingLoad && !loading) {
      pendingLoad = false;
      untrack(() => void load());
    }
  });

  async function loadObjects(schema: string) {
    if (objects[schema]?.state !== "ok") objects[schema] = { state: "loading" };
    try {
      const c = { handle, lease };
      const v = await serial(() => dbObjects(c.handle, c.lease, schema));
      objects[schema] = { state: "ok", value: v };
      oncatalog?.({ ...c, kind: "objects", schema, objects: v });
    } catch (e) {
      if (loading && busyHit) {
        delete objects[schema];
        pendingLoad = true;
        return;
      }
      objects[schema] = { state: "error", message: fail(e) };
    }
  }

  async function loadDetail(key: string) {
    const rel = relationFor(objectMap, key);
    if (!rel) return;
    if (details[key]?.state !== "ok") details[key] = { state: "loading" };
    try {
      const c = { handle, lease };
      const v = await serial(() => dbTableDetail(c.handle, c.lease, rel.schema, rel.name));
      details[key] = { state: "ok", value: v };
      oncatalog?.({ ...c, kind: "detail", schema: rel.schema, name: rel.name, detail: v });
    } catch (e) {
      if (loading && busyHit) {
        delete details[key];
        pendingLoad = true;
        return;
      }
      details[key] = { state: "error", message: fail(e) };
    }
  }

  /** 스키마 목록을 읽고, 펼쳐 둔 스키마의 객체 · 펼쳐 둔 관계의 구조를 다시 읽는다(펼침은 그대로) */
  async function load() {
    if (loading) return;
    if (busy) {
      // 연결이 다른 일을 하는 중 — 끝나면 읽는다(예전에는 여기서 그냥 돌아가 트리가 빈 채로 남았다)
      pendingLoad = true;
      return;
    }
    loading = true;
    busyHit = false;
    error = null;
    let names: string[];
    try {
      const c = { handle, lease };
      const s = await serial(() => dbSchema(c.handle, c.lease));
      names = s.schemas.map((x) => x.name);
      schemas = names;
      oncatalog?.({ ...c, kind: "schemas", schemas: names });
    } catch (e) {
      if (busyHit) {
        loading = false;
        pendingLoad = true;
        return;
      }
      error = fail(e);
      loading = false;
      return;
    }
    const skip = skipSchemaLevel(dialect, names);
    for (const n of names) if (skip || expanded.includes(schemaKey(n))) await loadObjects(n);
    for (const k of expanded) if (relationFor(objectMap, k)) await loadDetail(k);
    loading = false;
  }

  // 연결(핸들 · 임대)이 바뀌면 다시 읽는다 — 다시 열기 · 재부착(펼침은 그대로)
  let lastConn = "";
  $effect(() => {
    const c = `${handle}:${lease}`;
    if (c === lastConn) return;
    lastConn = c;
    untrack(() => {
      objects = {};
      details = {};
      void load();
    });
  });

  /** 필터 중 안내 — 아직 안 읽은(또는 실패한) 스키마를 모두 읽는다(줄 세워 하나씩) */
  async function loadUnread() {
    if (busy || !schemas) return;
    for (const n of schemas) if (objects[n]?.state !== "ok" && objects[n]?.state !== "loading") await loadObjects(n);
  }

  /**
   * 필터 칸으로(`Ctrl+I` · 결과 칸 밖에서 누른 앱의 `find` 키 — `QueryView` 의 찾기 문) — 적어 둔 글자는 통째로 골라 곧바로 덮어 칠
   * 수 있게
   */
  export function focusFilter() {
    filterEl?.focus();
    filterEl?.select();
  }

  /** 앱의 `find` 조합인가(사용자가 다시 묶었을 수 있다 · 끈 조합은 아무것과도 같지 않다) */
  function isFindCombo(ev: KeyboardEvent): boolean {
    const combo = comboFromEvent(ev);
    return combo !== null && combo === effectiveCombo("find", settings.current.keybindings);
  }

  function filterKey(ev: KeyboardEvent) {
    if (ev.isComposing) return;
    if (ev.key === "Escape") {
      ev.preventDefault();
      ev.stopPropagation();
      if (filter !== "") filter = "";
      else focusTree();
    } else if (ev.key === "ArrowDown" || (ev.key === "Enter" && !ev.ctrlKey)) {
      ev.preventDefault();
      focusTree();
    } else if (ev.code === "KeyI" && ev.ctrlKey && !ev.altKey && !ev.shiftKey) {
      ev.preventDefault();
      ev.stopPropagation();
      filterEl?.select();
    } else if (isFindCombo(ev)) {
      // 칸 안의 앱 `find` 키 — 전역 처리기의 입력 칸 가드에 걸려 오지 않는다. `Ctrl+I` 와 같은 몸짓(다시 고르기)
      ev.preventDefault();
      filterEl?.select();
    }
  }

  /** 트리로 — 초점 줄(없으면 첫 줄) */
  function focusTree() {
    const key = tabKey;
    if (key) focusRow(key);
    else bodyEl?.focus();
  }

  /** 이 줄을 펴려면 서버에서 읽어야 하나 */
  function needsLoad(r: TreeRow): boolean {
    if (r.type === "schema") return objects[r.schema]?.state !== "ok";
    if (r.type === "object") return details[r.key]?.state !== "ok";
    return false;
  }

  function setOpen(r: TreeRow, open: boolean) {
    if (!isExpandable(r)) return;
    if (open && busy && needsLoad(r)) return;
    expanded = toggled(expanded, r.key, open);
    if (!open) return;
    if (r.type === "schema" && needsLoad(r)) void loadObjects(r.schema);
    if (r.type === "object" && needsLoad(r)) void loadDetail(r.key);
  }

  function activate(r: TreeRow) {
    if (r.type === "schema" || r.type === "folder" || r.type === "part") {
      setOpen(r, !r.expanded);
    } else if (r.type === "object") {
      const rel = relationOf(r);
      if (rel) onopen(rel);
      else oninsert(insertText(dialect, r.schema, r.object));
    } else if (r.type === "column") {
      const text = leafInsertText(dialect, r.schema, { part: "columns", item: r.column });
      if (text) oninsert(text);
    } else if (r.type === "leaf") {
      const l = r.leaf;
      if (l.part === "foreignKeys" || l.part === "referencedBy") {
        const to = fkTarget(l.part, l.item);
        void reveal(to.schema, to.table);
      } else if (l.part === "partitions") {
        const rel = relationOf(r);
        if (rel) onopen(rel);
      } else {
        const text = leafInsertText(dialect, r.schema, l);
        if (text) oninsert(text);
      }
    }
  }

  /**
   * 외래 키를 따라 테이블 하나로 간다 — 그 스키마의 객체를 아직 안 읽었으면 읽고, 조상(스키마 · 폴더)을 펴고, 그 줄을 고른다.
   * 트리에 없는 테이블(목록에 안 서는 스키마 · 파티션 · 권한 밖)이면 편집기에 이름을 넣는 것으로 대신한다.
   */
  async function reveal(schema: string, table: string) {
    const fallback = () => oninsert(qualifiedName(dialect, schema, table));
    if (!schemas?.includes(schema)) return fallback();
    if (objects[schema]?.state !== "ok") {
      if (busy) return;
      await loadObjects(schema);
    }
    const load = objects[schema];
    const target = load?.state === "ok" ? findRelation(load.value, table) : null;
    if (!target) return fallback();
    expanded = withExpanded(expanded, revealKeys(dialect, schemas, schema, target));
    await tick();
    focusRow(objectKey(schema, target));
  }

  function focusRow(key: string) {
    focusKey = key;
    const i = rows.findIndex((r) => r.key === key);
    rowEls[i]?.focus();
    rowEls[i]?.scrollIntoView({ block: "nearest" });
  }

  /** 이 줄의 정의 대상(없으면 `null`) */
  const defOf = (r: TreeRow): DbDefinitionTarget | null => definitionTarget(dialect, r);

  function openContext(ev: MouseEvent, r: TreeRow) {
    const d = defOf(r);
    if (!d) return;
    ev.preventDefault();
    ev.stopPropagation();
    focusKey = r.key;
    oncontext(ev, d, definitionName(dialect, d), relationOf(r));
  }

  function onKey(ev: KeyboardEvent) {
    if (ev.code === "KeyI" && ev.ctrlKey && !ev.altKey && !ev.shiftKey && !ev.metaKey) {
      ev.preventDefault();
      ev.stopPropagation();
      focusFilter();
      return;
    }
    if (ev.altKey || ev.ctrlKey || ev.metaKey || ev.isComposing) return;
    if (ev.key === "F4" && !ev.shiftKey) {
      const r = rows.find((x) => x.key === focusKey);
      const d = r ? defOf(r) : null;
      if (d) {
        ev.preventDefault();
        ev.stopPropagation();
        ondefinition(d);
      }
      return;
    }
    const a = keyAction(rows, focusKey, ev.key);
    if (!a) return;
    ev.preventDefault();
    ev.stopPropagation();
    const r = rows.find((x) => x.key === a.key);
    if (a.kind === "focus") focusRow(a.key);
    else if (r && a.kind === "expand") setOpen(r, true);
    else if (r && a.kind === "collapse") setOpen(r, false);
    else if (r && a.kind === "activate") activate(r);
  }

  /** 종류별 아이콘 — 앱이 이미 싣는 UI 아이콘 묶음(`ui-icons.generated.ts`) 안에서 고른다 */
  const ICON: Record<DbObjectKind, string> = {
    table: "grid",
    view: "view-compact",
    matview: "layout",
    foreign: "external",
    function: "snippet",
    procedure: "list-checks",
    sequence: "list",
    type: "case-sensitive",
  };

  /** 구조 폴더 잎의 아이콘 */
  const LEAF_ICON: Record<Exclude<DetailPart, "columns">, string> = {
    indexes: "sort-name",
    constraints: "shield-check",
    foreignKeys: "route",
    referencedBy: "git-compare",
    triggers: "zap",
    partitions: "grid",
  };

  const folderLabel = (k: DbObjectKind) => t(`pane.query.schema.folder.${k}` as "pane.query.schema.folder.table");
  const partLabel = (p: DetailPart) => t(`pane.query.schema.part.${p}` as "pane.query.schema.part.columns");
  const subLabel = (s: string) => t(`pane.query.schema.sub.${s}` as "pane.query.schema.sub.enum");
  const conLabel = (c: string) => t(`pane.query.schema.con.${c}` as "pane.query.schema.con.primary");
  const cols = (c: readonly (string | null)[]) => columnList(c, t("pane.query.schema.expr"));

  /** 잎 옆의 흐린 글자 — 갈래 */
  function aside(o: DbObject): string | null {
    return o.sub ? subLabel(o.sub) : null;
  }

  function objectTitle(r: Extract<TreeRow, { type: "object" }>): string {
    const o = r.object;
    // 관계 줄(두 번 누르기 = 데이터 탭)은 설명 말풍선을 두지 않는다 — 이름은 줄에 보인다(2026-11-10 사용자 결정)
    if (r.expandable) return "";
    const lines = [t("pane.query.schema.insert", { name: signature(o) })];
    if (o.sub) lines.push(subLabel(o.sub));
    if (defOf(r)) lines.push(t("pane.query.def.hint"));
    return lines.join("\n");
  }

  /** 구조 폴더 잎 하나의 글자 — 이름 · 옆 글자(흐림) · 말풍선 */
  function leafView(l: DetailLeaf, here: string): { name: string; side: string; title: string } {
    const insert = (name: string) => t("pane.query.schema.insert", { name });
    const lines = (xs: string[]) => xs.filter(Boolean).join("\n");
    switch (l.part) {
      case "indexes": {
        const x = l.item;
        const tag = x.primary ? " PK" : x.unique ? " UNIQUE" : "";
        return {
          name: x.name,
          side: cols(x.columns) + tag,
          title: lines([
            insert(x.name),
            x.method ? t("pane.query.schema.method", { method: x.method }) : "",
            x.predicate ? t("pane.query.schema.where", { expr: x.predicate }) : "",
            x.definition ?? "",
          ]),
        };
      }
      case "constraints": {
        const x = l.item;
        const side = [x.name ? conLabel(x.type) : "", x.columns.length ? cols(x.columns) : ""].filter(Boolean).join(" ");
        return { name: x.name ?? conLabel(x.type), side, title: lines([x.name ? insert(x.name) : "", x.definition ?? ""]) };
      }
      case "foreignKeys":
      case "referencedBy": {
        const x = l.item;
        const to = fkTarget(l.part, x);
        const rules = [x.onUpdate ? `ON UPDATE ${x.onUpdate}` : "", x.onDelete ? `ON DELETE ${x.onDelete}` : ""].filter(Boolean).join(" · ");
        const name = to.schema === here ? to.table : `${to.schema}.${to.table}`;
        return { name: x.name ?? "", side: fkArrow(l.part, x, here), title: lines([t("pane.query.schema.goto", { name }), rules]) };
      }
      case "triggers": {
        const x = l.item;
        return { name: x.name, side: x.detail, title: lines([insert(x.name), x.definition ?? ""]) };
      }
      case "partitions": {
        const x = l.item;
        const name = x.schema === here ? x.name : `${x.schema}.${x.name}`;
        return { name, side: x.sub ? subLabel(x.sub) : "", title: lines([x.bound ?? ""]) };
      }
    }
  }
</script>

<!-- 필터와 맞는 자리를 강조한다(대소문자 무시 — `matchSpan`) -->
{#snippet hl(text: string)}
  {@const m = matchSpan(text, filter)}
  {#if m}{text.slice(0, m[0])}<mark class="hit">{text.slice(m[0], m[1])}</mark>{text.slice(m[1])}{:else}{text}{/if}
{/snippet}

<div class="tree" data-query-schema>
  <div class="tree-head">
    <span class="tree-title">{t("pane.query.schema.title")}</span>
    <button
      type="button"
      class="tbtn refresh"
      class:spinning
      disabled={busy || loading}
      title={t("pane.query.schema.refresh")}
      aria-label={t("pane.query.schema.refresh")}
      aria-busy={loading}
      data-query-schema-refresh
      onclick={() => {
        spinning = true;
        void load();
      }}
      onanimationiteration={() => {
        if (!loading) spinning = false;
      }}><UiIcon name="refresh" size={12} /></button
    >
  </div>
  <div class="filter" class:on={filter.trim() !== ""}>
    <UiIcon name="filter" size={12} />
    <input
      class="filter-input"
      type="text"
      spellcheck="false"
      autocomplete="off"
      placeholder={t("pane.query.filter.placeholder")}
      aria-label={t("pane.query.filter.placeholder")}
      title={t("pane.query.filter.title")}
      data-query-tree-filter
      bind:this={filterEl}
      bind:value={filter}
      onkeydown={filterKey}
    />
    {#if filter !== ""}
      <button
        type="button"
        class="fclear"
        title={t("pane.query.filter.clear")}
        aria-label={t("pane.query.filter.clear")}
        onclick={() => {
          filter = "";
          filterEl?.focus();
        }}><UiIcon name="close" size={11} /></button
      >
    {/if}
  </div>
  <div
    class="tree-body"
    role="tree"
    aria-label={t("pane.query.schema.title")}
    aria-busy={loading}
    tabindex="-1"
    bind:this={bodyEl}
    onkeydown={onKey}
  >
    {#if error}
      <p class="note err">{error}</p>
    {:else if !schemas}
      <p class="note">{t("pane.query.schema.loading")}</p>
    {:else if schemas.length === 0}
      <p class="note">{t("pane.query.schema.empty")}</p>
    {:else}
      {#each rows as r, i (r.key)}
        {#if r.type === "note" && r.note === "unread"}
          <p class="note unread" data-query-tree-unread={r.count}>
            {t("pane.query.filter.unread", { n: r.count ?? 0 })}
            <button type="button" class="linkbtn" disabled={busy || loading} onclick={() => void loadUnread()} data-query-tree-load-all
              >{t("pane.query.filter.loadAll")}</button
            >
          </p>
        {:else if r.type === "note" && r.note === "nomatch"}
          <p class="note" data-query-tree-nomatch>{t("pane.query.filter.nomatch")}</p>
        {:else if r.type === "note"}
          <p class="note" class:err={r.note === "error"} style:padding-left="{28 + r.level * 14}px">
            {#if r.note === "loading"}{t("pane.query.schema.loading")}{:else if r.note === "empty"}{t(
                "pane.query.schema.emptySchema",
              )}{:else if r.note === "truncated"}{t("pane.query.schema.truncated", { n: 5000 })}{:else}{r.message}{/if}
          </p>
        {:else if r.type === "column"}
          {@const col = r.column}
          <!-- svelte-ignore a11y_click_events_have_key_events — 키보드는 트리 묶음(role=tree)이 받는다 -->
          <div
            bind:this={rowEls[i]}
            class="row col"
            role="treeitem"
            aria-level={r.level + 1}
            aria-selected={focusKey === r.key}
            tabindex={tabKey === r.key ? 0 : -1}
            style:padding-left="{22 + r.level * 14}px"
            title={[t("pane.query.schema.insert", { name: col.name }), col.default !== null ? t("pane.query.schema.default", { value: col.default }) : ""]
              .filter(Boolean)
              .join("\n")}
            data-query-tree-row="column"
            onfocus={() => (focusKey = r.key)}
            onclick={() => {
              focusKey = r.key;
              activate(r);
            }}
          >
            {#if col.pk > 0}<span class="pk" title={t("pane.query.schema.pk")}><UiIcon name="key" size={11} /></span
              >{:else}<span class="pk"></span>{/if}
            <span class="nm">{@render hl(col.name)}</span>
            <span class="ty">{col.type || "—"}{col.notNull ? " · NOT NULL" : ""}</span>
          </div>
        {:else}
          {@const canOpen = isExpandable(r)}
          {@const open = "expanded" in r && r.expanded}
          {@const blocked = canOpen && !open && busy && needsLoad(r)}
          {@const leaf = r.type === "leaf" ? leafView(r.leaf, r.schema) : null}
          <!-- svelte-ignore a11y_click_events_have_key_events — 키보드는 트리 묶음(role=tree)이 받는다 -->
          <div
            bind:this={rowEls[i]}
            class="row"
            class:folder={r.type === "folder" || r.type === "part"}
            role="treeitem"
            aria-level={r.level + 1}
            aria-expanded={canOpen ? open : undefined}
            aria-selected={focusKey === r.key}
            aria-disabled={blocked || undefined}
            tabindex={tabKey === r.key ? 0 : -1}
            style:padding-left="{4 + r.level * 14}px"
            title={r.type === "object"
              ? objectTitle(r)
              : r.type === "schema"
                ? r.schema
                : r.type === "folder"
                  ? folderLabel(r.folder.kind)
                  : r.type === "part"
                    ? partLabel(r.folder.part)
                    : [leaf?.title ?? "", defOf(r) ? t("pane.query.def.hint") : ""].filter(Boolean).join("\n")}
            data-query-tree-row={r.type}
            data-query-table={r.type === "object" && r.expandable ? r.object.name : undefined}
            data-query-part={r.type === "part" ? r.folder.part : r.type === "leaf" ? r.leaf.part : undefined}
            onfocus={() => (focusKey = r.key)}
            onmousedown={(ev) => {
              // 두 번 누르기가 이름 글자를 골라(파랗게) 칠하지 않게
              if (ev.detail > 1) ev.preventDefault();
            }}
            onclick={() => {
              focusKey = r.key;
              // 관계 · 파티션 줄의 한 번 누르기는 고르기만 — 펼치기/접기는 › 화살표(·→/←)로만, 데이터 탭은 두 번 누르기(아래).
              // 줄 누르기로 펼치면 두 번 누르기(데이터 탭)마다 구조 폴더가 함께 열려 버린다(2026-11-10 사용자 결정)
              if (relationOf(r)) return;
              if (!blocked) activate(r);
            }}
            ondblclick={() => {
              const rel = relationOf(r);
              if (rel) onopen(rel);
            }}
            oncontextmenu={(ev) => openContext(ev, r)}
          >
            {#if canOpen}
              <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions — 키보드는 ←/→ -->
              <span
                class="twisty"
                class:dim={blocked}
                ondblclick={(ev) => ev.stopPropagation()}
                onclick={(ev) => {
                  ev.stopPropagation();
                  focusKey = r.key;
                  if (!blocked) setOpen(r, !open);
                }}><span class="chev" class:down={open}><UiIcon name="chevron" size={11} /></span></span
              >
            {:else}
              <span class="twisty"></span>
            {/if}
            {#if r.type === "schema"}
              <UiIcon name="database" size={12} />
              <span class="nm">{r.schema}</span>
            {:else if r.type === "folder"}
              <span class="ficon"><UiIcon name={open ? "folder-open" : "folder"} size={12} filled /></span>
              <span class="nm">{folderLabel(r.folder.kind)}</span>
              <span class="count">{countLabel(r.folder)}</span>
            {:else if r.type === "part"}
              <span class="ficon"><UiIcon name={open ? "folder-open" : "folder"} size={12} filled /></span>
              <span class="nm">{partLabel(r.folder.part)}</span>
              <span class="count">{countLabel(r.folder)}</span>
            {:else if r.type === "leaf" && leaf}
              <UiIcon name={LEAF_ICON[r.leaf.part]} size={12} />
              {#if leaf.name}<span class="nm">{@render hl(leaf.name)}</span>{/if}
              {#if leaf.side}<span class="side">{leaf.side}</span>{/if}
            {:else if r.type === "object"}
              {@const o = r.object}
              {@const side = aside(o)}
              <UiIcon name={ICON[o.kind]} size={12} />
              <span class="nm">{@render hl(o.name)}{#if o.args !== undefined}<span class="args">({o.args})</span>{/if}</span>
              {#if side}<span class="kind">{side}</span>{/if}
            {/if}
          </div>
        {/if}
      {/each}
    {/if}
  </div>
</div>

<style>
  .tree {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    min-width: 0;
    font-size: var(--t-xs);
  }

  .tree-head {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 6px 4px 10px;
    border-bottom: 1px solid var(--line);
  }

  .tree-title {
    flex: 1 1 auto;
    color: var(--fg-2);
    font-weight: var(--fw-semibold);
  }

  /* 이름 필터 — 머리 아래 한 줄(파일 타일의 필터 줄과 같은 칸 모양) */
  .filter {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 4px 6px 4px 10px;
    color: var(--fg-muted);
    border-bottom: 1px solid var(--line);
  }

  .filter.on {
    color: var(--accent);
  }

  .filter-input {
    flex: 1 1 auto;
    min-width: 0;
    height: 20px;
    padding: 0 10px;
    font-family: var(--font-ui);
    font-size: var(--t-xs);
    color: var(--fg);
    background: var(--surface-field);
    border: 1px solid var(--line);
    border-radius: 999px;
    outline: none;
  }

  .filter-input:focus {
    border-color: var(--accent);
  }

  .fclear {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    padding: 0;
    color: var(--fg-muted);
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    cursor: pointer;
  }

  .fclear:hover {
    color: var(--fg);
    background: var(--bg-hover);
  }

  .note.unread {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 6px;
  }

  .linkbtn {
    padding: 0;
    font: inherit;
    color: var(--accent);
    background: none;
    border: none;
    cursor: pointer;
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .linkbtn:disabled {
    opacity: 0.5;
    cursor: default;
  }

  /* 필터와 맞는 자리 */
  .hit {
    color: inherit;
    background: var(--warn-soft);
    border-radius: 2px;
    box-shadow: inset 0 -1px 0 var(--warn);
  }

  .tree-body {
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
    padding: 4px 0;
    outline: none;
  }

  .note {
    margin: 0;
    padding: 3px 10px;
    color: var(--fg-3);
    line-height: 1.45;
  }

  .note.err {
    color: var(--err);
    user-select: text;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 5px;
    height: 22px;
    padding-right: 6px;
    color: var(--fg-1);
    border-radius: var(--radius-sm);
    cursor: pointer;
    white-space: nowrap;
  }

  .row:hover {
    background: var(--bg-hover);
  }

  .row:focus-visible {
    outline: 1px solid var(--focus-border);
    outline-offset: -1px;
  }

  .row[aria-disabled="true"] {
    cursor: default;
  }

  .row.folder {
    color: var(--fg-2);
  }

  .row.col {
    height: 20px;
  }

  .twisty {
    flex: 0 0 18px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 20px;
    margin-right: -3px;
    color: var(--fg-3);
  }

  .twisty.dim {
    opacity: 0.4;
  }

  .chev {
    display: inline-flex;
    transition: transform 0.12s ease;
  }

  .chev.down {
    transform: rotate(90deg);
  }

  .ficon {
    display: inline-flex;
    color: var(--folder);
  }

  .nm {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .args,
  .kind,
  .count {
    color: var(--fg-3);
  }

  .kind,
  .count {
    flex: 0 0 auto;
  }

  .count {
    margin-left: auto;
    font-variant-numeric: tabular-nums;
  }

  /* 구조 잎의 옆 글자 — 열 목록 · 화살표 · 때. 길면 줄인다(전체는 말풍선) */
  .side {
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--fg-3);
  }

  .pk {
    flex: 0 0 11px;
    display: inline-flex;
    color: var(--warn);
  }

  .ty {
    flex: 0 1 auto;
    margin-left: auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--fg-3);
  }

  .tbtn {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    padding: 3px;
    color: var(--fg-muted);
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--radius);
    cursor: pointer;
  }

  .tbtn:hover:not(:disabled) {
    color: var(--fg);
    background: var(--bg-hover);
  }

  .tbtn:disabled {
    opacity: 0.45;
    cursor: default;
  }

  /* 도는 동안은 흐리지 않는다 — 눌러서 돌고 있다는 것이 곧 응답이다 */
  .tbtn.refresh.spinning {
    opacity: 1;
  }

  .tbtn.refresh.spinning :global(svg) {
    animation: schema-spin 0.9s linear infinite;
  }

  @keyframes schema-spin {
    to {
      transform: rotate(360deg);
    }
  }

  /* 움직임을 줄여 달라고 했으면 돌리지 않고 읽는 동안 흐리게만(브랜치 타일과 같은 처방) — 바퀴 끝 이벤트가 없으니
     흐림은 `spinning` 이 아니라 `aria-busy` 를 따른다 */
  @media (prefers-reduced-motion: reduce) {
    .tbtn.refresh.spinning :global(svg) {
      animation: none;
    }
    .tbtn.refresh.spinning {
      opacity: 0.45;
    }
    .tbtn.refresh.spinning:not([aria-busy="true"]) {
      opacity: 1;
    }
  }
</style>
