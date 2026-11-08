import { describe, expect, it } from "vitest";
import {
  decodeHostsDrag,
  emptyHostMetaPatch,
  emptyHostsDrag,
  encodeHostsDrag,
  fuzzyMatch,
  groupPaths,
  hostLabel,
  hostMeta,
  hostSearchText,
  hostsDragEmpty,
  hostsInGroup,
  forwardAgentOn,
  forwardAgentPatch,
  identitiesOnlyFor,
  metaToPatch,
  nextCopyAlias,
  resolveHostsDrag,
  sameIdentityPath,
  shortenHomePath,
  type HostEntry,
  type HostMeta,
  type HostsDrag,
} from "$lib/hosts";

/** 별칭과 (선택) 그룹 경로만 가진 최소 호스트 — `~/.ssh/config` 한 줄에 해당한다 */
function host(name: string, group?: string): HostEntry {
  return {
    name,
    ...(group === undefined ? {} : { meta: { group, tags: [], forwards: [] } }),
  };
}

describe("hostMeta — 방어적 메타 꺼내기", () => {
  it("meta 가 없으면 빈 배열 둘(tags·forwards)만 있는 메타를 돌려준다", () => {
    expect(hostMeta({ name: "web-01" })).toEqual({ tags: [], forwards: [] });
  });

  it("meta 가 null 이어도 던지지 않는다 (옛 백엔드 대비)", () => {
    expect(hostMeta({ name: "web-01", meta: null })).toEqual({ tags: [], forwards: [] });
  });

  it("tags 가 배열이 아니면 빈 배열로 고쳐 준다", () => {
    // 손으로 적은 sessions.toml 에서 `tags = "prod"` 처럼 올 수 있다.
    const broken = { name: "web-01", meta: { color: "#fff", tags: "prod" } } as unknown as HostEntry;
    expect(hostMeta(broken)).toEqual({ color: "#fff", tags: [], forwards: [] });
  });

  it("나머지 필드는 그대로 통과시킨다", () => {
    const m: HostMeta = {
      color: "tomato",
      icon: "🐧",
      group: "prod/web",
      tags: ["a", "b"],
      forwards: [],
    };
    expect(hostMeta({ name: "web-01", meta: m })).toEqual(m);
  });
});

describe("encodeHostsDrag / decodeHostsDrag — 왕복", () => {
  it("호스트와 폴더가 섞인 짐이 그대로 돌아온다", () => {
    const payload: HostsDrag = { hosts: ["web-01", "db-01"], groups: ["prod/web", "staging"] };
    expect(decodeHostsDrag(encodeHostsDrag(payload))).toEqual(payload);
  });

  it("빈 짐도 왕복한다", () => {
    expect(decodeHostsDrag(encodeHostsDrag(emptyHostsDrag()))).toEqual({ hosts: [], groups: [] });
  });

  it("encode 는 두 칸만 담는다 — 여분의 키는 실리지 않는다", () => {
    const extra = { hosts: ["a"], groups: [], junk: 1 } as unknown as HostsDrag;
    expect(JSON.parse(encodeHostsDrag(extra))).toEqual({ hosts: ["a"], groups: [] });
  });
});

describe("decodeHostsDrag — 모양이 어긋나면 조용히 빈 짐 (절대 던지지 않는다)", () => {
  // 드래그 데이터는 다른 창·옛 버전에서 올 수 있어 여기서 던지면 드롭이 반쯤 처리된 채 멈춘다.
  const cases: Array<[label: string, raw: string]> = [
    ["빈 문자열", ""],
    ["JSON 이 아님", "not json at all"],
    ["잘린 JSON", '{"hosts":['],
    ["null 리터럴", "null"],
    ["숫자 리터럴", "42"],
    ["문자열 리터럴", '"web-01"'],
    ["최상위가 배열", '["web-01","db-01"]'],
    ["필드가 아예 없음", "{}"],
    ["hosts 가 배열이 아님", '{"hosts":"web-01","groups":"prod"}'],
    ["hosts 가 null", '{"hosts":null,"groups":null}'],
    ["원소가 전부 비문자열", '{"hosts":[1,true,null,{}],"groups":[[]]}'],
    ["원소가 전부 공백 문자열", '{"hosts":["","   "],"groups":["\\t"]}'],
  ];

  for (const [label, raw] of cases) {
    it(`${label} → 빈 짐`, () => {
      expect(() => decodeHostsDrag(raw)).not.toThrow();
      const out = decodeHostsDrag(raw);
      expect(out).toEqual({ hosts: [], groups: [] });
      expect(hostsDragEmpty(out)).toBe(true);
    });
  }

  it("반만 어긋난 짐은 성한 쪽만 살린다", () => {
    expect(decodeHostsDrag('{"hosts":["web-01"],"groups":"prod"}')).toEqual({
      hosts: ["web-01"],
      groups: [],
    });
  });

  it("배열 안의 쓰레기 원소만 골라 떨어낸다", () => {
    expect(decodeHostsDrag('{"hosts":["web-01",7,"","db-01"],"groups":["prod",null]}')).toEqual({
      hosts: ["web-01", "db-01"],
      groups: ["prod"],
    });
  });
});

describe("hostsDragEmpty", () => {
  it("양쪽이 비었을 때만 참", () => {
    expect(hostsDragEmpty({ hosts: [], groups: [] })).toBe(true);
    expect(hostsDragEmpty({ hosts: ["a"], groups: [] })).toBe(false);
    expect(hostsDragEmpty({ hosts: [], groups: ["prod"] })).toBe(false);
  });
});

describe("hostsInGroup — 그룹 접두사", () => {
  const hosts: HostEntry[] = [
    host("web-01", "prod"),
    host("web-02", "prod/web"),
    host("db-01", "prod/db/primary"),
    host("app-01", "production/web"), // ← `prod` 가 잡으면 안 되는 오탐 후보
    host("prodigy", "prodigy"), // ← 접두사만 겹치는 다른 폴더
    host("free-01"), // ← 그룹 없음
  ];

  it("자기 그룹과 하위 그룹을 모두 포함한다", () => {
    expect(hostsInGroup(hosts, "prod").map((h) => h.name)).toEqual(["web-01", "web-02", "db-01"]);
  });

  it("접두사 오탐이 없다 — `prod` 가 `production/web`·`prodigy` 를 잡지 않는다", () => {
    const names = hostsInGroup(hosts, "prod").map((h) => h.name);
    expect(names).not.toContain("app-01");
    expect(names).not.toContain("prodigy");
  });

  it("하위 그룹을 직접 가리키면 그 아래만 나온다", () => {
    expect(hostsInGroup(hosts, "prod/db").map((h) => h.name)).toEqual(["db-01"]);
  });

  it("순서는 입력(= ~/.ssh/config 등장 순서) 그대로다", () => {
    const reversed = [...hosts].reverse();
    expect(hostsInGroup(reversed, "prod").map((h) => h.name)).toEqual(["db-01", "web-02", "web-01"]);
  });

  it("그룹 경로의 앞뒤 공백은 무시한다 (질의 쪽·값 쪽 모두)", () => {
    expect(hostsInGroup(hosts, "  prod  ").map((h) => h.name)).toContain("web-01");
    expect(hostsInGroup([host("x", " prod")], "prod").map((h) => h.name)).toEqual(["x"]);
  });

  it("빈 경로는 빈 목록 (그룹 없는 호스트를 몽땅 끌어오지 않는다)", () => {
    expect(hostsInGroup(hosts, "")).toEqual([]);
    expect(hostsInGroup(hosts, "   ")).toEqual([]);
  });

  it("없는 그룹은 빈 목록", () => {
    expect(hostsInGroup(hosts, "nope")).toEqual([]);
  });
});

describe("resolveHostsDrag — 짐을 열 별칭 목록으로", () => {
  const hosts: HostEntry[] = [
    host("web-01", "prod"),
    host("web-02", "prod/web"),
    host("app-01", "production/web"),
    host("db-01", "staging"),
  ];

  it("폴더를 하위 폴더까지 펼친다", () => {
    expect(resolveHostsDrag(hosts, { hosts: [], groups: ["prod"] })).toEqual(["web-01", "web-02"]);
  });

  it("그룹 접두사 오탐이 없다 — `prod` 로 `production/web` 이 딸려 오지 않는다", () => {
    expect(resolveHostsDrag(hosts, { hosts: [], groups: ["prod"] })).not.toContain("app-01");
  });

  it("폴더와 그 안의 호스트를 함께 골라도 중복이 없다", () => {
    expect(resolveHostsDrag(hosts, { hosts: ["web-02"], groups: ["prod"] })).toEqual([
      "web-01",
      "web-02",
    ]);
  });

  it("같은 별칭을 여러 번 실어도 한 번만 나온다", () => {
    expect(resolveHostsDrag(hosts, { hosts: ["web-01", "web-01"], groups: [] })).toEqual(["web-01"]);
  });

  it("겹치는 폴더 둘을 함께 끌어도 중복이 없다", () => {
    expect(resolveHostsDrag(hosts, { hosts: [], groups: ["prod", "prod/web"] })).toEqual([
      "web-01",
      "web-02",
    ]);
  });

  it("순서는 짐이 아니라 ~/.ssh/config 등장 순서다", () => {
    expect(resolveHostsDrag(hosts, { hosts: ["db-01", "web-01", "app-01"], groups: [] })).toEqual([
      "web-01",
      "app-01",
      "db-01",
    ]);
  });

  it("목록에 없는 별칭은 버리지 않고 맨 뒤에 붙인다", () => {
    expect(resolveHostsDrag(hosts, { hosts: ["ghost", "web-01"], groups: [] })).toEqual([
      "web-01",
      "ghost",
    ]);
  });

  it("맨 뒤에 붙는 낯선 별칭도 짐에 실린 순서를 지키고 중복되지 않는다", () => {
    expect(resolveHostsDrag(hosts, { hosts: ["ghost-b", "ghost-a", "ghost-b"], groups: [] })).toEqual(
      ["ghost-b", "ghost-a"],
    );
  });

  it("빈 짐은 빈 목록", () => {
    expect(resolveHostsDrag(hosts, emptyHostsDrag())).toEqual([]);
  });

  it("없는 폴더만 든 짐도 빈 목록 (던지지 않는다)", () => {
    expect(resolveHostsDrag(hosts, { hosts: [], groups: ["nope"] })).toEqual([]);
  });

  it("호스트 목록이 비어 있으면 실린 별칭이 그대로 순서대로 나온다", () => {
    expect(resolveHostsDrag([], { hosts: ["a", "b"], groups: ["prod"] })).toEqual(["a", "b"]);
  });

  it("입력 트리를 건드리지 않는 순수 함수다", () => {
    const before = JSON.stringify(hosts);
    resolveHostsDrag(hosts, { hosts: ["web-01"], groups: ["prod"] });
    expect(JSON.stringify(hosts)).toBe(before);
  });

  it("decode 를 지나온 짐과도 이어 붙는다 (드롭 경로 전체)", () => {
    const raw = encodeHostsDrag({ hosts: ["ghost"], groups: ["prod"] });
    expect(resolveHostsDrag(hosts, decodeHostsDrag(raw))).toEqual(["web-01", "web-02", "ghost"]);
  });
});

describe("metaToPatch / emptyHostMetaPatch", () => {
  it("빈 패치는 아홉 칸이 전부 비어 있다 (tags·forwards 만 배열)", () => {
    expect(emptyHostMetaPatch()).toEqual({
      color: null,
      icon: null,
      group: null,
      tags: [],
      scrollback: null,
      on_connect: null,
      log: null,
      shell_integration: null,
      tmux: null,
      forwards: [],
      forward_agent: null,
      agent: null,
      agent_args: null,
    });
  });

  it("원본 메타를 패치로 그대로 펼친다", () => {
    const m: HostMeta = {
      color: "#c25b4a",
      icon: "🔥",
      group: "prod/web",
      tags: ["a"],
      scrollback: 10_000,
      on_connect: "cd /srv/app",
      log: true,
      shell_integration: false,
      tmux: true,
      forwards: [{ local_port: 15432, remote_host: "localhost", remote_port: 5432 }],
      forward_agent: true,
      agent: false,
      agent_args: { claude: "--model opus", codex: "" },
    };
    expect(metaToPatch(m)).toEqual({ ...m });
  });

  it("없는 값은 null 로, tags 는 언제나 배열로 떨어진다", () => {
    expect(metaToPatch({ tags: [], forwards: [] })).toEqual(emptyHostMetaPatch());
  });

  it("forward_agent 의 false 도 null 로 뭉개지지 않는다 (config 의 yes 를 끄는 값)", () => {
    expect(metaToPatch({ tags: [], forwards: [], forward_agent: false }).forward_agent).toBe(false);
  });

  it("shell_integration 의 false 는 null 로 뭉개지지 않는다 (`끔` 이 살아 있어야 한다)", () => {
    expect(metaToPatch({ tags: [], forwards: [], shell_integration: false }).shell_integration).toBe(
      false,
    );
  });
});

describe("fuzzyMatch — 부분수열 매칭", () => {
  it("빈 질의는 언제나 참", () => {
    expect(fuzzyMatch("", "web-01")).toBe(true);
    expect(fuzzyMatch("   ", "web-01")).toBe(true);
  });

  it("떨어져 있는 글자들도 순서만 맞으면 걸린다", () => {
    expect(fuzzyMatch("w01", "web-01")).toBe(true);
  });

  it("순서가 어긋나면 걸리지 않는다", () => {
    expect(fuzzyMatch("01w", "web-01")).toBe(false);
  });

  it("대소문자를 무시한다", () => {
    expect(fuzzyMatch("WEB", "web-01")).toBe(true);
    expect(fuzzyMatch("web", "WEB-01")).toBe(true);
  });

  it("질의의 공백은 무시한다", () => {
    expect(fuzzyMatch("w e b", "web-01")).toBe(true);
  });

  it("없는 글자가 있으면 거짓", () => {
    expect(fuzzyMatch("z", "web-01")).toBe(false);
  });
});

describe("hostLabel — user@host:port", () => {
  it("셋이 다 있으면 다 잇는다", () => {
    expect(hostLabel({ name: "x", user: "root", host_name: "10.0.0.1", port: 2222 })).toBe(
      "root@10.0.0.1:2222",
    );
  });

  it("host_name 만 있으면 그것뿐", () => {
    expect(hostLabel({ name: "x", host_name: "10.0.0.1" })).toBe("10.0.0.1");
  });

  it("아무것도 없으면 빈 문자열", () => {
    expect(hostLabel({ name: "x" })).toBe("");
  });

  it("host_name 이 없어도 남은 조각은 보여 준다", () => {
    expect(hostLabel({ name: "x", user: "root" })).toBe("root@");
    expect(hostLabel({ name: "x", port: 22 })).toBe(":22");
  });
});

describe("hostSearchText — 그룹·태그까지 훑는다", () => {
  it("별칭·접속 정보·그룹·태그가 모두 들어간다", () => {
    const h: HostEntry = {
      name: "web-01",
      host_name: "10.0.0.1",
      user: "root",
      meta: { group: "prod/web", tags: ["edge", "nginx"], forwards: [] },
    };
    const text = hostSearchText(h);
    expect(text).toContain("web-01");
    expect(text).toContain("root@10.0.0.1");
    expect(text).toContain("prod/web");
    expect(text).toContain("edge");
    expect(text).toContain("nginx");
  });

  it("그룹으로도 태그로도 퍼지 검색에 걸린다", () => {
    const byGroup: HostEntry = { name: "a", meta: { group: "prod/web", tags: [], forwards: [] } };
    const byTag: HostEntry = { name: "b", meta: { tags: ["prod"], forwards: [] } };
    expect(fuzzyMatch("prod", hostSearchText(byGroup))).toBe(true);
    expect(fuzzyMatch("prod", hostSearchText(byTag))).toBe(true);
  });

  it("메타가 없어도 던지지 않는다", () => {
    expect(hostSearchText({ name: "web-01" })).toContain("web-01");
  });
});

describe("groupPaths — 그룹 칸 자동완성 후보", () => {
  it("조상 경로까지 각각 한 줄로 편다", () => {
    expect(groupPaths([host("a", "prod/web")])).toEqual(["prod", "prod/web"]);
  });

  it("중복은 하나로 접고 사전순으로 준다", () => {
    const list = [host("a", "prod/web"), host("b", "prod/db"), host("c", "dev")];
    expect(groupPaths(list)).toEqual(["dev", "prod", "prod/db", "prod/web"]);
  });

  it("그룹이 없거나 빈 세그먼트뿐이면 후보가 없다", () => {
    expect(groupPaths([host("a"), host("b", "   "), host("c", "//")])).toEqual([]);
  });

  it("세그먼트의 앞뒤 공백은 떼고 본다", () => {
    expect(groupPaths([host("a", " prod / web ")])).toEqual(["prod", "prod/web"]);
  });
});

describe("nextCopyAlias — 복제 별칭 고르기", () => {
  it("비어 있으면 `-copy`", () => {
    expect(nextCopyAlias("web", [])).toBe("web-copy");
  });

  it("이미 있으면 -copy-2, -copy-3 … 으로 밀린다", () => {
    expect(nextCopyAlias("web", ["web-copy"])).toBe("web-copy-2");
    expect(nextCopyAlias("web", ["web-copy", "web-copy-2"])).toBe("web-copy-3");
  });

  it("**대소문자를 무시하고** 비교한다 (백엔드 add_host 와 같은 규칙)", () => {
    expect(nextCopyAlias("web", ["WEB-COPY"])).toBe("web-copy-2");
  });

  it("이번 묶음에서 방금 집은 이름도 함께 넘기면 겹치지 않는다", () => {
    // 파일을 다시 읽기 전이라 목록에는 없지만 이미 만들어진 것들
    expect(nextCopyAlias("web", ["web", "web-copy"])).toBe("web-copy-2");
  });
});

describe("shortenHomePath — IdentityFile 표기", () => {
  it("홈 아래면 `~` 로 줄이되 **구분자는 원본 그대로** 둔다", () => {
    expect(shortenHomePath("C:\\Users\\me\\.ssh\\id_ed25519", "C:\\Users\\me")).toBe(
      "~\\.ssh\\id_ed25519",
    );
    expect(shortenHomePath("/home/me/.ssh/id_ed25519", "/home/me")).toBe("~/.ssh/id_ed25519");
  });

  it("구분자와 대소문자만 무시하고 비교한다", () => {
    expect(shortenHomePath("C:/Users/Me/.ssh/k", "c:\\users\\me")).toBe("~/.ssh/k");
  });

  it("홈 밖이면 손대지 않는다", () => {
    expect(shortenHomePath("D:\\keys\\id", "C:\\Users\\me")).toBe("D:\\keys\\id");
  });

  it("홈 끝의 구분자는 있으나 없으나 같다", () => {
    expect(shortenHomePath("/home/me/k", "/home/me/")).toBe("~/k");
  });

  it("홈 자신은 그대로 둔다 (개인키 자리가 아니다)", () => {
    expect(shortenHomePath("/home/me", "/home/me")).toBe("/home/me");
  });
});

describe("sameIdentityPath — 볼트의 전체 경로 ↔ IdentityFile 칸의 글자", () => {
  it("`~` 로 적은 칸은 담긴 전체 경로의 **꼬리**로 맞춘다", () => {
    expect(sameIdentityPath("C:\\Users\\me\\.ssh\\id_ed25519", "~/.ssh/id_ed25519")).toBe(true);
    expect(sameIdentityPath("/home/me/.ssh/id_ed25519", "~/.ssh/id_ed25519")).toBe(true);
  });

  it("구분자와 대소문자는 무시한다 (`~\\.ssh\\…` 로 적은 파일도 맞는다)", () => {
    expect(sameIdentityPath("C:/Users/Me/.ssh/ID_ed25519", "~\\.ssh\\id_ed25519")).toBe(true);
  });

  it("전체 경로끼리는 그대로 맞춘다 (따옴표·양 끝 공백은 뗀다)", () => {
    expect(sameIdentityPath("/home/me/.ssh/k", ' "/home/me/.ssh/k" ')).toBe(true);
  });

  it("다른 키는 맞지 않는다 — 이름 한 조각이 겹쳐도", () => {
    expect(sameIdentityPath("/home/me/.ssh/id_ed25519_work", "~/.ssh/id_ed25519")).toBe(false);
    expect(sameIdentityPath("/home/me/.ssh/id_rsa", "~/.ssh/id_ed25519")).toBe(false);
  });

  it("빈 값은 아무것과도 맞지 않는다 (IdentityFile 을 안 적은 호스트)", () => {
    expect(sameIdentityPath("/home/me/.ssh/k", "")).toBe(false);
    expect(sameIdentityPath("", "~/.ssh/k")).toBe(false);
  });
});

describe("identitiesOnlyFor — 폼의 스위치가 파일에 적힐 값", () => {
  it("키 파일이 있고 켜져 있으면 참이다 (= `IdentitiesOnly yes` 한 줄)", () => {
    expect(identitiesOnlyFor(true, "~/.ssh/id_ed25519")).toBe(true);
  });

  it("꺼져 있으면 거짓이다 — 키 파일이 있어도 (`no` 를 적지 않고 줄을 지운다)", () => {
    expect(identitiesOnlyFor(false, "~/.ssh/id_ed25519")).toBe(false);
  });

  it("**키 파일이 비면 켜져 있어도 거짓이다** — 그때의 yes 는 기대한 일을 하지 않는다", () => {
    expect(identitiesOnlyFor(true, "")).toBe(false);
    expect(identitiesOnlyFor(true, "   ")).toBe(false);
  });
});

describe("에이전트 포워딩 — 폼의 스위치와 sessions.toml 의 덮어쓰기", () => {
  it("스위치는 덮어쓰기가 있으면 그것, 없으면 config 로 선다", () => {
    expect(forwardAgentOn(true, null)).toBe(true);
    expect(forwardAgentOn(true, false)).toBe(false);
    expect(forwardAgentOn(false, true)).toBe(true);
    expect(forwardAgentOn(undefined, undefined)).toBe(false);
  });

  it("config 와 같은 값이면 덮어쓰기를 적지 않는다 (null = 키 삭제)", () => {
    expect(forwardAgentPatch(false, false)).toBeNull();
    expect(forwardAgentPatch(false, undefined)).toBeNull();
    expect(forwardAgentPatch(true, true)).toBeNull();
  });

  it("다를 때만 true/false 가 적힌다", () => {
    expect(forwardAgentPatch(true, false)).toBe(true);
    expect(forwardAgentPatch(false, true)).toBe(false);
  });

  it("왕복: 원본 메타 → 스위치 → 패치 → 같은 원본", () => {
    for (const config of [true, false]) {
      for (const raw of [null, true, false] as const) {
        const on = forwardAgentOn(config, raw);
        const patch = forwardAgentPatch(on, config);
        // 적힌 값이 config 와 같았으면 지워지고, 달랐으면 그대로 남는다 — 접속이 볼 값은 같다.
        expect(forwardAgentOn(config, patch)).toBe(forwardAgentOn(config, raw));
      }
    }
  });
});
