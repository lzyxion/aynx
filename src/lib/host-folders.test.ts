import { describe, expect, it } from "vitest";
import {
  affectedHosts,
  canDropGroupInto,
  canDropInto,
  canNestInto,
  childFolderNames,
  folderOfRow,
  folderRows,
  groupMetaPathsUnder,
  groupPathOf,
  hostTreeRows,
  lastSegment,
  normalizeGroupPath,
  parentOfRow,
  parentPath,
  parseExpandedGroups,
  payloadOfIds,
  planMoveInto,
  planPasteCopy,
  rebaseExpanded,
  rowId,
  segmentsOf,
  uniqueFolderName,
} from "$lib/host-folders";
import type { GroupMeta, HostEntry } from "$lib/hosts";

/** 별칭과 (선택) 그룹 경로만 가진 최소 호스트 — `~/.ssh/config` 한 줄에 해당한다 */
function host(name: string, group?: string): HostEntry {
  return { name, ...(group === undefined ? {} : { meta: { group, tags: [], forwards: [] } }) };
}

/** 그룹 메타 표 — 값은 아이콘 하나뿐이라 `{path: icon}` 로 적는다 */
function meta(table: Record<string, string>): Record<string, GroupMeta> {
  const out: Record<string, GroupMeta> = {};
  for (const [path, icon] of Object.entries(table)) out[path] = { icon };
  return out;
}

describe("경로 쪼개기", () => {
  it("빈 세그먼트와 공백을 버린다", () => {
    expect(segmentsOf("prod//web")).toEqual(["prod", "web"]);
    expect(segmentsOf("/prod/")).toEqual(["prod"]);
    expect(segmentsOf("  prod / web ")).toEqual(["prod", "web"]);
  });

  it("없거나 빈 값은 홈(빈 배열)이다", () => {
    expect(segmentsOf(null)).toEqual([]);
    expect(segmentsOf(undefined)).toEqual([]);
    expect(segmentsOf("   ")).toEqual([]);
  });

  it("normalizeGroupPath 는 그 결과를 다시 이어 붙인다", () => {
    expect(normalizeGroupPath(" /prod// web ")).toBe("prod/web");
    expect(normalizeGroupPath(null)).toBe("");
  });

  it("그룹이 없는 호스트는 홈에 있다", () => {
    expect(groupPathOf(host("a"))).toBe("");
    expect(groupPathOf(host("a", "prod/web"))).toBe("prod/web");
  });

  it("마지막 세그먼트 · 부모 경로", () => {
    expect(lastSegment("prod/web")).toBe("web");
    expect(lastSegment("prod")).toBe("prod");
    expect(parentPath("prod/web")).toBe("prod");
    expect(parentPath("prod")).toBe("");
  });
});

describe("folderRows — 한 층만 만든다", () => {
  const list = [
    host("web-01", "prod/web"),
    host("db-01", "prod/db"),
    host("gw", "prod"),
    host("laptop"),
  ];

  it("홈에서는 최상위 폴더와 **그룹 없는** 호스트가 보인다", () => {
    const rows = folderRows(list, "", {});
    expect(rows.map((r) => (r.kind === "folder" ? `📁${r.label}` : r.host.name))).toEqual([
      "📁prod",
      "laptop",
    ]);
  });

  it("폴더가 먼저, 직속 호스트가 나중이다 — 둘 다 이름순(입력 순서가 아니다)", () => {
    const rows = folderRows(list, "prod", {});
    expect(rows.map((r) => (r.kind === "folder" ? r.label : r.host.name))).toEqual([
      "db",
      "web",
      "gw",
    ]);
  });

  it("이름순은 대소문자를 무시하고 숫자를 자연순으로 본다 (설정 파일 순서가 아니다 — 10-20 사용자 보고)", () => {
    const hosts = [host("web-10"), host("Zeta"), host("web-2"), host("alpha"), host("Beta")];
    expect(folderRows(hosts, "", {}).map((r) => r.kind === "host" && r.host.name)).toEqual([
      "alpha",
      "Beta",
      "web-2",
      "web-10",
      "Zeta",
    ]);
    const folders = [host("a", "Prod"), host("b", "dev"), host("c", "box-10"), host("d", "box-9")];
    expect(folderRows(folders, "", {}).map((r) => r.kind === "folder" && r.label)).toEqual(["box-9", "box-10", "dev", "Prod"]);
  });

  it("개수는 **하위 폴더까지 합쳐** 센다", () => {
    const rows = folderRows(list, "", {});
    const prod = rows[0];
    expect(prod.kind === "folder" && prod.count).toBe(3);
  });

  it("그룹 메타에만 있는 **빈 폴더**도 보인다 (0개)", () => {
    const rows = folderRows([], "", meta({ staging: "📁" }));
    expect(rows).toEqual([{ kind: "folder", fullPath: "staging", label: "staging", count: 0 }]);
  });

  it("메타의 깊은 경로도 **조상까지** 이 층에 걸린다", () => {
    expect(folderRows([], "", meta({ "a/b/c": "📁" })).map((r) => r.kind === "folder" && r.label))
      .toEqual(["a"]);
    expect(folderRows([], "a", meta({ "a/b/c": "📁" })).map((r) => r.kind === "folder" && r.label))
      .toEqual(["b"]);
  });

  it("메타에만 있는 빈 폴더도 호스트에서 나온 폴더와 함께 이름순으로 선다", () => {
    const rows = folderRows([host("x", "used")], "", meta({ empty: "📁" }));
    expect(rows.map((r) => (r.kind === "folder" ? r.label : r.host.name))).toEqual([
      "empty",
      "used",
    ]);
  });

  it("다른 가지는 이 층과 무관하다", () => {
    expect(folderRows([host("x", "other/deep")], "prod", {})).toEqual([]);
  });
});

describe("rowId — 폴더와 호스트가 섞이지 않게", () => {
  it("접두사가 이름 충돌을 가른다", () => {
    expect(rowId({ kind: "folder", fullPath: "prod", label: "prod", count: 1 })).toBe("g:prod");
    expect(rowId({ kind: "host", host: host("prod"), })).toBe("h:prod");
  });
});

describe("payloadOfIds — 보이는 순서대로 편다", () => {
  it("`Set` 의 순회 순서가 아니라 `order` 를 따른다", () => {
    const order = ["g:a", "h:x", "g:b", "h:y"];
    const ids = new Set(["h:y", "g:b", "h:x"]); // 고른 순서는 뒤죽박죽
    expect(payloadOfIds(order, ids)).toEqual({ groups: ["b"], hosts: ["x", "y"] });
  });

  it("고르지 않은 것은 빠진다", () => {
    expect(payloadOfIds(["g:a", "h:x"], new Set())).toEqual({ groups: [], hosts: [] });
  });
});

describe("childFolderNames — 화면과 같은 기준으로 센다", () => {
  it("호스트에서 나온 폴더와 메타에만 있는 폴더를 모두 센다", () => {
    const names = childFolderNames([host("x", "prod/web")], "prod", meta({ "prod/empty": "📁" }));
    expect([...names].sort()).toEqual(["empty", "web"]);
  });
});

describe("옮길 수 있는가", () => {
  it("자기 자신·자손으로는 못 넣는다 (순환)", () => {
    expect(canNestInto("a", "a")).toBe(false);
    expect(canNestInto("a", "a/b")).toBe(false);
  });

  it("이미 직속 자식이면 옮길 것이 없다", () => {
    expect(canNestInto("a/b", "a")).toBe(false);
    expect(canNestInto("a/b", "c")).toBe(true);
  });

  it("홈으로 옮기기는 **이미 최상위가 아닐 때만** 뜻이 있다", () => {
    expect(canDropGroupInto("a", "")).toBe(false);
    expect(canDropGroupInto("a/b", "")).toBe(true);
    expect(canDropGroupInto(null, "")).toBe(false);
  });

  it("호스트가 하나라도 있으면 언제나 받는다 (같은 폴더로 다시 지정해도 무해)", () => {
    expect(canDropInto({ hosts: ["x"], groups: [] }, "a")).toBe(true);
  });

  it("폴더만 있으면 그중 하나라도 옮길 수 있어야 받는다", () => {
    expect(canDropInto({ hosts: [], groups: ["a"] }, "a")).toBe(false);
    expect(canDropInto({ hosts: [], groups: ["a", "b"] }, "a")).toBe(true);
  });

  it("짐을 못 보면(다른 창) 일단 받아 두고 놓는 순간에 판정한다", () => {
    expect(canDropInto(null, "a")).toBe(true);
  });
});

describe("planMoveInto — 폴더가 먼저, 딸린 호스트는 낱개에서 뺀다", () => {
  const list = [host("web-01", "prod/web"), host("gw", "prod"), host("laptop")];

  it("중첩은 대상 경로 아래에 마지막 세그먼트를 붙인다", () => {
    const { renames } = planMoveInto({ hosts: [], groups: ["prod/web"] }, "staging", list);
    expect(renames).toEqual([{ from: "prod/web", to: "staging/web" }]);
  });

  it("홈으로 옮기면 부모를 통째로 뗀다", () => {
    const { renames } = planMoveInto({ hosts: [], groups: ["prod/web"] }, "", list);
    expect(renames).toEqual([{ from: "prod/web", to: "web" }]);
  });

  it("**끌린 폴더 아래의 호스트는 낱개 이동에서 빠진다** (폴더와 함께 간다)", () => {
    const plan = planMoveInto({ hosts: ["web-01", "laptop"], groups: ["prod"] }, "x", list);
    expect(plan.names).toEqual(["laptop"]);
  });

  it("옮길 수 없는 폴더는 계획에서 조용히 빠진다", () => {
    const plan = planMoveInto({ hosts: [], groups: ["prod"] }, "prod", list);
    expect(plan.renames).toEqual([]);
  });
});

describe("uniqueFolderName", () => {
  it("비어 있으면 그대로, 겹치면 -copy 를 붙여 올린다", () => {
    expect(uniqueFolderName("web", new Set())).toBe("web");
    expect(uniqueFolderName("web", new Set(["web"]))).toBe("web-copy");
    expect(uniqueFolderName("web", new Set(["web", "web-copy"]))).toBe("web-copy-2");
  });
});

describe("planPasteCopy", () => {
  const list = [host("web-01", "prod/web"), host("gw", "prod"), host("laptop")];

  it("호스트 하나는 지금 폴더로 (홈이면 그룹 없음)", () => {
    expect(planPasteCopy({ hosts: ["laptop"], groups: [] }, "", list, {}, "📁").items).toEqual([
      { name: "laptop", group: null },
    ]);
    expect(planPasteCopy({ hosts: ["laptop"], groups: [] }, "x", list, {}, "📁").items).toEqual([
      { name: "laptop", group: "x" },
    ]);
  });

  it("폴더 복사는 **하위 구조를 유지한다**", () => {
    const plan = planPasteCopy({ hosts: [], groups: ["prod"] }, "staging", list, {}, "📁");
    expect(plan.items).toEqual([
      { name: "web-01", group: "staging/prod/web" },
      { name: "gw", group: "staging/prod" },
    ]);
  });

  it("뿌리 폴더에 아이콘이 없어도 **폴더 자체는 생긴다** (빈 폴더의 존재 증거)", () => {
    const plan = planPasteCopy({ hosts: [], groups: ["prod"] }, "", list, {}, "📁");
    expect(plan.metaWrites).toEqual([{ path: "prod-copy", icon: "📁", color: null }]);
  });

  it("아이콘은 하위까지 따라간다", () => {
    const table = meta({ prod: "🚀", "prod/web": "🐳" });
    const plan = planPasteCopy({ hosts: [], groups: ["prod"] }, "staging", list, table, "📁");
    expect(plan.metaWrites).toEqual([
      { path: "staging/prod", icon: "🚀", color: null },
      { path: "staging/prod/web", icon: "🐳", color: null },
    ]);
  });

  it("폴더 색도 따라간다 — 색만 있는 폴더도 적는다", () => {
    const table: Record<string, GroupMeta> = {
      prod: { icon: "svg:lucide:folder-git-2", color: "#4a90d9" },
      "prod/web": { icon: null, color: "#e5484d" },
    };
    const plan = planPasteCopy({ hosts: [], groups: ["prod"] }, "staging", list, table, "📁");
    expect(plan.metaWrites).toEqual([
      { path: "staging/prod", icon: "svg:lucide:folder-git-2", color: "#4a90d9" },
      { path: "staging/prod/web", icon: null, color: "#e5484d" },
    ]);
  });

  it("같은 층에 이름이 겹치면 -copy 가 붙는다", () => {
    const plan = planPasteCopy({ hosts: [], groups: ["prod"] }, "", list, {}, "📁");
    expect(plan.items.map((i) => i.group)).toEqual(["prod-copy/web", "prod-copy"]);
  });

  it("자기 안으로 복사하는 것은 거절하고 안내만 남긴다", () => {
    const plan = planPasteCopy({ hosts: [], groups: ["prod"] }, "prod/web", list, {}, "📁");
    expect(plan.items).toEqual([]);
    expect(plan.notices).toEqual([
      { key: "app.hosts.paste.selfcopy", params: { name: "prod" } },
    ]);
  });

  it("폴더에 딸려 이미 복제되는 호스트는 낱개로 또 담지 않는다", () => {
    const plan = planPasteCopy({ hosts: ["gw"], groups: ["prod"] }, "staging", list, {}, "📁");
    expect(plan.items.filter((i) => i.name === "gw")).toHaveLength(1);
  });
});

describe("affectedHosts · groupMetaPathsUnder — 제거가 실제로 건드리는 것", () => {
  const list = [host("web-01", "prod/web"), host("gw", "prod"), host("laptop")];

  it("폴더는 그 아래를 펼친다 (중복은 한 번만)", () => {
    expect(affectedHosts({ hosts: ["gw"], groups: ["prod"] }, list).sort()).toEqual([
      "gw",
      "web-01",
    ]);
  });

  it("빈 폴더만 골랐으면 건드릴 호스트가 없다", () => {
    expect(affectedHosts({ hosts: [], groups: ["nope"] }, list)).toEqual([]);
  });

  it("그룹 메타는 그 폴더와 **하위 전부**를 치운다", () => {
    const table = meta({ prod: "🚀", "prod/web": "🐳", other: "📁" });
    expect(groupMetaPathsUnder(["prod"], table).sort()).toEqual(["prod", "prod/web"]);
  });
});

describe("hostTreeRows — 펼친 폴더 아래에 그 층을 잇는다", () => {
  const list = [
    host("web-01", "prod"),
    host("db-01", "prod/db"),
    host("db-02", "prod/db"),
    host("dev-01", "dev"),
    host("laptop"),
  ];
  const shape = (rows: ReturnType<typeof hostTreeRows>) =>
    rows.map((r) =>
      r.kind === "folder"
        ? `${"  ".repeat(r.depth)}${r.expanded ? "▾" : "▸"}${r.label}(${r.count})${r.auto ? "*" : ""}`
        : `${"  ".repeat(r.depth)}${r.host.name}`,
    );

  it("모두 접혀 있으면 최상위 한 층 — 폴더 먼저(이름순), 그룹 없는 호스트 뒤", () => {
    expect(shape(hostTreeRows(list, {}, new Set(), ""))).toEqual(["▸dev(1)", "▸prod(3)", "laptop"]);
  });

  it("펼친 폴더 아래에 그 층이 한 단 들여 선다 (중첩 폴더는 제 펼침을 따른다)", () => {
    expect(shape(hostTreeRows(list, {}, new Set(["prod"]), ""))).toEqual([
      "▸dev(1)",
      "▾prod(3)",
      "  ▸db(2)",
      "  web-01",
      "laptop",
    ]);
    expect(shape(hostTreeRows(list, {}, new Set(["prod", "prod/db"]), ""))).toEqual([
      "▸dev(1)",
      "▾prod(3)",
      "  ▾db(2)",
      "    db-01",
      "    db-02",
      "  web-01",
      "laptop",
    ]);
  });

  it("부모가 접혀 있으면 펼쳐 둔 자식도 보이지 않는다 (상태는 그대로 남는다)", () => {
    expect(shape(hostTreeRows(list, {}, new Set(["prod/db"]), ""))).toEqual(["▸dev(1)", "▸prod(3)", "laptop"]);
  });

  it("그룹 메타에만 있는 빈 폴더도 선다 (0개)", () => {
    expect(shape(hostTreeRows([], meta({ empty: "📁" }), new Set(["empty"]), ""))).toEqual(["▾empty(0)"]);
  });

  it("검색은 걸린 호스트를 품은 폴더를 **저절로** 펼친다 — 개수는 걸린 수", () => {
    expect(shape(hostTreeRows(list, meta({ empty: "📁" }), new Set(), "db-0"))).toEqual([
      "▾prod(2)*",
      "  ▾db(2)*",
      "    db-01",
      "    db-02",
    ]);
  });

  it("검색은 폴더 이름으로도 걸린다 (검색 글자가 그룹 경로를 품는다) · 그룹 없는 호스트는 최상위", () => {
    expect(shape(hostTreeRows(list, {}, new Set(), "dev"))).toEqual(["▾dev(1)*", "  dev-01"]);
    expect(shape(hostTreeRows(list, {}, new Set(), "laptop"))).toEqual(["laptop"]);
    expect(hostTreeRows(list, {}, new Set(), "zzz-nothing")).toEqual([]);
  });

  it("sortLevel 은 층마다 불린다 — 폴더 자리는 그대로, 호스트만 다시 선다", () => {
    const reverseHosts = (rows: ReturnType<typeof folderRows>) => {
      const hosts = rows.filter((r) => r.kind === "host").reverse();
      let i = 0;
      return rows.map((r) => (r.kind === "host" ? hosts[i++] : r));
    };
    const two = [host("a", "g"), host("b", "g"), host("x"), host("y")];
    expect(shape(hostTreeRows(two, {}, new Set(["g"]), "", { sortLevel: reverseHosts }))).toEqual([
      "▾g(2)",
      "  b",
      "  a",
      "y",
      "x",
    ]);
  });

  it("호스트 줄은 마지막 성공 접속 시각을 든다 — 없으면 null (줄 뒷글자 '2분 전' 의 근거)", () => {
    const at: Record<string, number> = { "db-01": 1_000, laptop: 2_000 };
    const lastOkOf = (alias: string) => at[alias] ?? null;
    const rows = hostTreeRows(list, {}, new Set(["prod", "prod/db"]), "", { lastOkOf });
    const times = rows.flatMap((r) => (r.kind === "host" ? [`${r.host.name}=${r.lastOkAt}`] : []));
    expect(times).toEqual(["db-01=1000", "db-02=null", "web-01=null", "laptop=2000"]);
    // 검색으로 저절로 펼친 줄도 같은 값을 든다
    const hit = hostTreeRows(list, {}, new Set(), "db-01", { lastOkOf });
    expect(hit.flatMap((r) => (r.kind === "host" ? [r.lastOkAt] : []))).toEqual([1_000]);
  });

  it("lastOkOf 가 없으면 모든 호스트 줄이 null — 이력 없이도 트리는 선다", () => {
    const rows = hostTreeRows(list, {}, new Set(["dev"]), "");
    expect(rows.flatMap((r) => (r.kind === "host" ? [r.lastOkAt] : []))).toEqual([null, null]);
  });

  it("검색은 주소(IP)로도 걸린다 — 줄 뒷글자에서 빠져 말풍선으로 갔어도 검색 글자에는 남는다", () => {
    const withIp: HostEntry[] = [{ ...host("web-01", "prod"), host_name: "10.0.0.1", user: "root" }, host("laptop")];
    expect(shape(hostTreeRows(withIp, {}, new Set(), "10.0.0.1"))).toEqual(["▾prod(1)*", "  web-01"]);
  });
});

describe("트리 줄의 부모 · 가리키는 폴더", () => {
  it("parentOfRow — 폴더는 부모 경로, 호스트는 제 그룹", () => {
    expect(parentOfRow({ kind: "folder", fullPath: "prod/db", label: "db", count: 0 })).toBe("prod");
    expect(parentOfRow({ kind: "folder", fullPath: "prod", label: "prod", count: 0 })).toBe("");
    expect(parentOfRow({ kind: "host", host: host("db-01", "prod/db") })).toBe("prod/db");
    expect(parentOfRow({ kind: "host", host: host("laptop") })).toBe("");
  });

  it("folderOfRow — 폴더는 그 자신, 호스트는 든 폴더, 없으면 최상위", () => {
    expect(folderOfRow({ kind: "folder", fullPath: "prod", label: "prod", count: 0 })).toBe("prod");
    expect(folderOfRow({ kind: "host", host: host("db-01", "prod/db") })).toBe("prod/db");
    expect(folderOfRow(undefined)).toBe("");
  });
});

describe("펼침 저장", () => {
  it("parseExpandedGroups — 문자열 배열만 받고 모양이 어긋나면 빈 집합", () => {
    expect([...parseExpandedGroups('["prod","prod/db"]')]).toEqual(["prod", "prod/db"]);
    expect([...parseExpandedGroups('["a",3,null]')]).toEqual(["a"]);
    expect(parseExpandedGroups(null).size).toBe(0);
    expect(parseExpandedGroups("{oops").size).toBe(0);
    expect(parseExpandedGroups('{"a":1}').size).toBe(0);
  });

  it("rebaseExpanded — 이름 변경·이동은 가지째 옮겨 적고, 해제는 버린다", () => {
    const set = new Set(["prod", "prod/db", "production", "dev"]);
    expect([...rebaseExpanded(set, "prod", "ops/prod")].sort()).toEqual(["dev", "ops/prod", "ops/prod/db", "production"]);
    expect([...rebaseExpanded(set, "prod", "")].sort()).toEqual(["dev", "production"]);
  });

  it("rebaseExpanded — 걸리는 것이 없으면 같은 집합을 돌려준다", () => {
    const set = new Set(["dev"]);
    expect(rebaseExpanded(set, "prod", "x")).toBe(set);
  });
});
