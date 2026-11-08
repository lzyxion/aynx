import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  canDropDbInto,
  dbChildFolderNames,
  dbDragEmpty,
  dbPayloadOfKeys,
  dbDockTree,
  dbFolderNameProblem,
  dbFolderOfRow,
  dbParentOfRow,
  moveDbInto,
  parseDbFolderMeta,
  planDbPasteCopy,
  removeDbItems,
  renameDbFolder,
  serializeDbFolderMeta,
} from "./db-folders";
import { connOfRow, connRowOf, emptyConnRow } from "./query/conn-form";
import { duplicateConnIn, type DbConn } from "./db-conn";
import { sameDbTarget } from "./db-ai";

const includes = (q: string, text: string) => text.toLowerCase().includes(q.toLowerCase());

const sq = (id: string, name: string, folder?: string): DbConn => ({
  id,
  name,
  engine: "sqlite",
  path: `C:\\d\\${name}.db`,
  ...(folder ? { folder } : {}),
});

const list: DbConn[] = [sq("Abcdef01", "zeta"), sq("Abcdef02", "alpha", "운영/웹"), sq("Abcdef03", "beta", "운영"), sq("Abcdef04", "gamma", "개발")];

describe("독 DB 칸 폴더 트리(10-15)", () => {
  it("층마다 폴더 먼저 · 연결 뒤, 둘 다 이름순 · 접힌 폴더는 아이를 숨긴다 · 개수는 하위 포함", () => {
    const rows = dbDockTree(list, {}, new Set(), "", includes);
    expect(rows.map((r) => (r.kind === "folder" ? `F:${r.fullPath}:${r.count}` : r.name))).toEqual(["F:개발:1", "F:운영:2", "zeta"]);
    const open = dbDockTree(list, {}, new Set(["운영", "운영/웹"]), "", includes);
    expect(open.map((r) => `${r.depth}:${r.kind === "folder" ? r.label : r.name}`)).toEqual([
      "0:개발",
      "0:운영",
      "1:웹",
      "2:alpha",
      "1:beta",
      "0:zeta",
    ]);
  });

  it("곁 파일의 빈 폴더도 선다(조상까지) · 검색 중에는 빈 폴더가 없고 걸린 연결의 조상을 저절로 편다", () => {
    const rows = dbDockTree(list, { "보관/옛": {} }, new Set(), "", includes);
    expect(rows.filter((r) => r.kind === "folder").map((r) => r.kind === "folder" && `${r.fullPath}:${r.count}`)).toContain("보관:0");
    const hit = dbDockTree(list, { 보관: {} }, new Set(), "alpha", includes);
    expect(hit.map((r) => (r.kind === "folder" ? `F:${r.fullPath}:${r.auto}` : r.name))).toEqual(["F:운영:true", "F:운영/웹:true", "alpha"]);
    // 폴더 이름으로 찾으면 그 안의 연결이 선다
    expect(dbDockTree(list, {}, new Set(), "개발", includes).some((r) => r.kind === "conn" && r.name === "gamma")).toBe(true);
  });

  it("정렬 단추 '최근'(10-20) — 층마다 연결만 그 연결의 마지막 성공순(연결 id) · 기록 없음은 뒤에서 이름순 · 폴더는 이름순 제자리", () => {
    const pg = (id: string, name: string, via?: string, folder?: string): DbConn => ({
      id,
      name,
      engine: "postgres",
      host: "localhost",
      ...(via ? { via } : {}),
      ...(folder ? { folder } : {}),
    });
    const conns = [
      pg("Abcdef11", "app-10"),
      pg("Abcdef12", "app-2", "old"),
      pg("Abcdef13", "Zeta", "new"),
      pg("Abcdef14", "beta", "never"),
      pg("Abcdef15", "inner", "new", "운영"),
      pg("Abcdef16", "box", undefined, "개발"),
    ];
    // 연결 자신의 기록 — 직접 연결(app-10)도 기록이 있으면 선다 · 같은 경유(new)여도 연결마다 따로 · 경유 호스트 이름은 보지 않는다
    const at: Record<string, number> = { Abcdef11: 3, Abcdef12: 1, Abcdef13: 2, new: 99, Abcdef15: 9 };
    const shape = (rows: ReturnType<typeof dbDockTree>) => rows.map((r) => (r.kind === "folder" ? `F:${r.label}` : r.name));
    // 이름순(기본) — 숫자 자연순 · 대소문자 무시
    expect(shape(dbDockTree(conns, {}, new Set(), "", includes))).toEqual(["F:개발", "F:운영", "app-2", "app-10", "beta", "Zeta"]);
    expect(shape(dbDockTree(conns, {}, new Set(), "", includes, (id) => at[id] ?? null))).toEqual([
      "F:개발",
      "F:운영",
      "app-10",
      "Zeta",
      "app-2",
      "beta",
    ]);
  });

  it("부모 · 가리키는 폴더 — ← 와 드롭 · [+] 의 자리", () => {
    const rows = dbDockTree(list, {}, new Set(["운영", "운영/웹"]), "", includes);
    const web = rows.find((r) => r.kind === "folder" && r.fullPath === "운영/웹")!;
    const alpha = rows.find((r) => r.kind === "conn" && r.name === "alpha")!;
    expect(dbParentOfRow(web)).toBe("운영");
    expect(dbParentOfRow(alpha)).toBe("운영/웹");
    expect(dbFolderOfRow(web)).toBe("운영/웹");
    expect(dbFolderOfRow(null)).toBe("");
  });

  it("이름 바꾸기 · 옮기기 · 해제 = 접두사 다시 쓰기(꾸밈도 함께 · 목적지 덮기 · 해제면 그 폴더 꾸밈은 버린다)", () => {
    const meta = { 운영: { icon: "🚀" }, "운영/웹": { color: "#f00" }, 개발: {} };
    const r = renameDbFolder(list, meta, "운영", "서비스");
    expect(r.conns.map((c) => c.folder)).toEqual([undefined, "서비스/웹", "서비스", "개발"]);
    expect(Object.keys(r.meta).sort()).toEqual(["개발", "서비스", "서비스/웹"]);
    expect(r.meta["서비스"]).toEqual({ icon: "🚀" });
    const off = renameDbFolder(list, meta, "운영", "");
    expect(off.conns.map((c) => c.folder)).toEqual([undefined, "웹", undefined, "개발"]);
    expect("folder" in off.conns[2]).toBe(false);
    expect(off.meta).toEqual({ 웹: { color: "#f00" }, 개발: {} });
    // 자기 아래로는 옮기지 않는다
    expect(renameDbFolder(list, meta, "운영", "운영/웹/x").conns).toEqual(list);
  });

  it("끌어다 놓기 — 연결은 다른 폴더로만 · 폴더는 순환 · 제자리 거절 · 최상위로 올리면 마지막 이름만", () => {
    expect(canDropDbInto({ conns: ["Abcdef03"], folders: [] }, "운영", list)).toBe(false);
    expect(canDropDbInto({ conns: ["Abcdef03"], folders: [] }, "", list)).toBe(true);
    expect(canDropDbInto({ conns: [], folders: ["운영"] }, "운영/웹", list)).toBe(false);
    expect(canDropDbInto({ conns: [], folders: ["운영/웹"] }, "운영", list)).toBe(false);
    expect(canDropDbInto(null, "", list)).toBe(false);
    const toTop = moveDbInto(list, {}, { conns: ["Abcdef03"], folders: [] }, "")!;
    expect(toTop.conns.find((c) => c.id === "Abcdef03")!.folder).toBeUndefined();
    const up = moveDbInto(list, { "운영/웹": { icon: "x" } }, { conns: [], folders: ["운영/웹"] }, "")!;
    expect(up.conns.find((c) => c.id === "Abcdef02")!.folder).toBe("웹");
    expect(up.meta).toEqual({ 웹: { icon: "x" } });
    const nest = moveDbInto(list, {}, { conns: [], folders: ["개발"] }, "운영")!;
    expect(nest.conns.find((c) => c.id === "Abcdef04")!.folder).toBe("운영/개발");
  });

  it("여러 줄 — 고른 키를 보이는 순서의 짐으로(연결 · 폴더) · 빈 짐", () => {
    const order = ["f:개발", "f:운영", "conn:Abcdef01"];
    expect(dbPayloadOfKeys(order, new Set(["conn:Abcdef01", "f:개발"]))).toEqual({ conns: ["Abcdef01"], folders: ["개발"] });
    expect(dbPayloadOfKeys(order, new Set(["f:없음"]))).toEqual({ conns: [], folders: [] });
    expect(dbDragEmpty({ conns: [], folders: [] })).toBe(true);
    expect(dbDragEmpty(null)).toBe(true);
  });

  it("여러 줄 이동 — 하나라도 옮겨지면 놓을 수 있다 · 이미 그 폴더인 것 · 순환은 건너뛴다 · 저장은 한 번의 결과", () => {
    // 둘 다 이미 최상위 · 최상위 폴더 → 최상위: 뜻이 없다(거절 규칙 그대로)
    expect(canDropDbInto({ conns: ["Abcdef01"], folders: ["운영"] }, "", list)).toBe(false);
    // 하나(beta)는 다른 폴더 → 받는다
    expect(canDropDbInto({ conns: ["Abcdef01", "Abcdef03"], folders: [] }, "", list)).toBe(true);
    const r = moveDbInto(list, {}, { conns: ["Abcdef01", "Abcdef04"], folders: [] }, "운영")!;
    expect(r.conns.map((c) => c.folder)).toEqual(["운영", "운영/웹", "운영", "운영"]);
    expect(r.moved).toEqual([]);
    // 폴더와 그 안의 연결 · 하위 폴더를 함께 끌면 폴더째(하위 구조가 납작해지지 않는다)
    const m = moveDbInto(list, { "운영/웹": { icon: "x" } }, { conns: ["Abcdef02", "Abcdef01"], folders: ["운영", "운영/웹"] }, "개발")!;
    expect(m.conns.map((c) => c.folder)).toEqual(["개발", "개발/운영/웹", "개발/운영", "개발"]);
    expect(m.meta).toEqual({ "개발/운영/웹": { icon: "x" } });
    expect(m.moved).toEqual([{ from: "운영", to: "개발/운영" }]);
    // 자기 안으로 가는 폴더는 건너뛰고 연결만 옮긴다
    const s = moveDbInto(list, {}, { conns: ["Abcdef01"], folders: ["운영"] }, "운영/웹")!;
    expect(s.conns.map((c) => c.folder)).toEqual(["운영/웹", "운영/웹", "운영", "개발"]);
    expect(s.moved).toEqual([]);
  });

  it("복사 붙여넣기 — 연결은 새 id · -copy, 폴더는 하위 · 꾸밈까지 통째로 · 같은 이름은 -copy · 자기 안은 거절", () => {
    let n = 0;
    const id = () => `Newid0${++n}`;
    const meta = { "운영/웹": { color: "#f00" } };
    const p = planDbPasteCopy(list, meta, { conns: ["Abcdef01", "Abcdef02"], folders: ["운영"] }, "", id);
    expect(p.copied).toBe(3);
    const added = p.conns.slice(list.length);
    expect(added.map((c) => `${c.id}:${c.name}:${c.folder ?? ""}`)).toEqual([
      "Newid01:alpha-copy:운영-copy/웹",
      "Newid02:beta-copy:운영-copy",
      "Newid03:zeta-copy:",
    ]);
    expect(p.meta["운영-copy/웹"]).toEqual({ color: "#f00" });
    expect(p.meta["운영-copy"]).toEqual({});
    expect(p.conns.slice(0, list.length)).toEqual(list);
    const self = planDbPasteCopy(list, {}, { conns: [], folders: ["운영"] }, "운영/웹", id);
    expect(self.copied).toBe(0);
    expect(self.notices).toEqual([{ key: "app.hosts.paste.selfcopy", params: { name: "운영" } }]);
  });

  it("여러 개 지우기 — 폴더는 아래 연결 전부와 꾸밈(하위 포함)을 치운다 · 지운 id 를 돌려준다", () => {
    const meta = { 운영: { icon: "🚀" }, "운영/웹": {}, 보관: {} };
    const r = removeDbItems(list, meta, { conns: ["Abcdef01"], folders: ["운영"] });
    expect(r.conns.map((c) => c.id)).toEqual(["Abcdef04"]);
    expect(r.removed).toEqual(["Abcdef01", "Abcdef02", "Abcdef03"]);
    expect(r.meta).toEqual({ 보관: {} });
    expect(removeDbItems(list, meta, { conns: [], folders: ["보관"] }).removed).toEqual([]);
  });

  it("독 목록 — 호스트 독과 같은 선택 부품 · 러버밴드 · 다중 메뉴 항목은 menu-runner 통로", () => {
    const dock = readFileSync(fileURLToPath(new URL("./browser/DbList.svelte", import.meta.url)), "utf8");
    expect(dock).toContain("const sel = createSelection();");
    expect(dock).toContain("onclick={(ev) => sel.click(ev, row.key, order)}");
    expect(dock).toContain('rects: () => boxesIn(bodyEl, listEl, "data-db-key")');
    expect(dock).toContain("const next = sel.forDrag(row.key, order);");
    const menu = readFileSync(fileURLToPath(new URL("./browser/DbMenu.svelte", import.meta.url)), "utf8");
    expect(menu).toContain('data-db-action="cut" onclick={() => runAfterClose(onclose, oncut)}');
    expect(menu).toContain("onclick={() => runOnMenu(() => pasteTarget, onclose, onpaste)}");
    expect(menu).toContain('data-db-action="folder-paste" onclick={() => onFolder(onpaste)}');
    expect(menu).toContain("onclick={() => runAfterClose(onclose, onremoveselection)}");
  });

  it("폴더 이름 검사 셋 · 같은 층 이름(빈 폴더 포함)", () => {
    const taken = dbChildFolderNames(list, { 보관: {} }, "");
    expect([...taken].sort()).toEqual(["개발", "보관", "운영"]);
    expect(dbFolderNameProblem("  ", taken)).toBe("app.hosts.folder.name.empty");
    expect(dbFolderNameProblem("a/b", taken)).toBe("app.hosts.folder.name.slash");
    expect(dbFolderNameProblem("운영", taken)).toBe("app.hosts.folder.name.dup");
    expect(dbFolderNameProblem("새것", taken)).toBeNull();
  });

  it("곁 파일 — 깨졌거나 모양이 어긋나면 버리고 · 경로는 다듬고 · 쓰기는 경로순", () => {
    expect(parseDbFolderMeta(null)).toEqual({});
    expect(parseDbFolderMeta("{nope")).toEqual({});
    expect(parseDbFolderMeta("[1]")).toEqual({});
    expect(parseDbFolderMeta(JSON.stringify({ " a / b ": { icon: " 🚀 ", color: "" }, c: 3, "": {} }))).toEqual({ "a/b": { icon: "🚀" } });
    expect(serializeDbFolderMeta({ b: {}, a: { color: "#fff" } })).toBe(JSON.stringify({ a: { color: "#fff" }, b: {} }, null, 2));
  });

  it("폼은 폴더 칸을 그대로 들고 간다(편집 · 새로 만들기) · 복제본은 원본 폴더 · 신원 비교는 폴더를 보지 않는다", () => {
    const d = sq("Abcdef09", "x", "운영/웹");
    const back = connOfRow(connRowOf(d));
    expect(back.ok && back.conn.folder).toBe("운영/웹");
    const fresh = emptyConnRow("Abcdef10", null, " 개발 / ");
    const made = connOfRow({ ...fresh, name: "n", path: "C:\\d\\n.db" });
    expect(made.ok && made.conn.folder).toBe("개발");
    const top = connOfRow({ ...emptyConnRow("Abcdef11"), name: "n", path: "C:\\d\\n.db" });
    expect(top.ok && "folder" in top.conn).toBe(false);
    const dup = duplicateConnIn([d], d.id, "Abcdef12")!;
    expect(dup.copy.folder).toBe("운영/웹");
    expect(sameDbTarget(d, { ...d, folder: "다른/곳" })).toBe(true);
  });

  it("메뉴 — 폴더 항목은 menu-runner 통로(`onFolder` → `runOnMenu`) · 독 목록은 같은 폴더 편집 상자(`FolderEditDialog`)", () => {
    const menu = readFileSync(fileURLToPath(new URL("./browser/DbMenu.svelte", import.meta.url)), "utf8");
    expect(menu).toContain("const onFolder = (fn: (path: string) => void | Promise<void>) => runOnMenu(() => folder, onclose, fn);");
    expect(menu).toContain('data-db-action="folder-new" onclick={() => onFolder(newDbConnIn)}');
    expect(menu).toContain('data-db-action="folder-edit" onclick={() => onFolder(oneditfolder)}');
    const dock = readFileSync(fileURLToPath(new URL("./browser/DbList.svelte", import.meta.url)), "utf8");
    expect(dock).toContain("<FolderEditDialog bind:edit={folderEdit}");
  });
});
