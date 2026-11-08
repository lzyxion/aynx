import { describe, expect, it } from "vitest";
import {
  MAX_SNIPPETS,
  SNIPPET_PREVIEW_CHARS,
  SNIPPET_NAME_CUT,
  SNIPPET_QUERY_PREFIX,
  SNIPPET_SUGGEST_LIMIT,
  SNIPPET_SUGGEST_PREVIEW_CHARS,
  defaultSnippetName,
  defaultValuesOf,
  placeholdersOf,
  parseSnippets,
  renderSnippet,
  serializeSnippets,
  snippetPaletteEntries,
  snippetPreview,
  snippetSaveLabel,
  snippetsForScope,
  suggestSnippets,
  shouldOfferSave,
  updateSnippet,
  withRenamedHostScope,
  withSnippet,
  withoutSnippet,
  type Snippet,
} from "$lib/snippets";

/** 테스트용 스니펫 하나 (칸을 덮어쓸 수 있다) */
function snip(over: Partial<Snippet> = {}): Snippet {
  return {
    id: "S1",
    name: "상태 보기",
    command: "systemctl status nginx",
    scope: { kind: "all" },
    enter: true,
    ...over,
  };
}

describe("placeholdersOf", () => {
  /** 이름만 뽑아 보는 짧은 손 (순서·중복 규칙을 읽기 쉽게) */
  const names = (cmd: string) => placeholdersOf(cmd).map((p) => p.name);

  it("나온 순서대로, 중복 없이 모은다", () => {
    expect(names("scp {{원본}} {{대상}}:{{원본}}")).toEqual(["원본", "대상"]);
  });

  it("토큰 안쪽 공백은 이름에서 떼어 낸다 — 같은 칸이다", () => {
    expect(names("a {{ 호스트 }} b {{호스트}}")).toEqual(["호스트"]);
  });

  it("빈 토큰은 자리표시자가 아니다", () => {
    expect(placeholdersOf("echo {{}} {{   }}")).toEqual([]);
  });

  it("중괄호가 겹친 셸 문법을 토큰으로 읽지 않는다", () => {
    // `${VAR}` 는 물론이고, 안쪽에 `{`·`}` 가 든 것은 토큰이 아니다.
    expect(placeholdersOf("echo ${HOME} {{a{b}}")).toEqual([]);
  });

  it("토큰이 없으면 빈 배열이고, 빈 입력도 던지지 않는다", () => {
    expect(placeholdersOf("ls -al")).toEqual([]);
    expect(placeholdersOf("")).toEqual([]);
    expect(placeholdersOf(null)).toEqual([]);
  });

  it("기본값만 (`{{이름=기본값}}`)", () => {
    expect(placeholdersOf("df -h {{경로=/var}}")).toEqual([{ name: "경로", default: "/var" }]);
  });

  it("설명만 (`{{이름|설명}}`)", () => {
    expect(placeholdersOf("df -h {{경로|어느 경로를 볼지}}")).toEqual([
      { name: "경로", description: "어느 경로를 볼지" },
    ]);
  });

  it("셋 다 (`{{이름=기본값|설명}}`) — 앞뒤 공백은 조각마다 떨어진다", () => {
    expect(placeholdersOf("df -h {{ 경로 = /var | 어느 경로를 볼지 }}")).toEqual([
      { name: "경로", default: "/var", description: "어느 경로를 볼지" },
    ]);
  });

  it("빈 기본값·빈 설명은 **없는 것**이다", () => {
    expect(placeholdersOf("echo {{a=}} {{b|}} {{c=|}}")).toEqual([
      { name: "a" },
      { name: "b" },
      { name: "c" },
    ]);
  });

  it("끊는 자리는 **첫 = 와 첫 |** 뿐이다 — 기본값에 = 는 되고 | 는 안 된다", () => {
    // 기본값 안의 `=` 는 글자로 남는다 (`--opt=1`).
    expect(placeholdersOf("run {{인자=--opt=1}}")).toEqual([
      { name: "인자", default: "--opt=1" },
    ]);
    // 그러나 `|` 는 언제나 설명의 시작이다 — 문법의 대가이고 문서에 적혀 있다.
    expect(placeholdersOf("run {{인자=a|b}}")).toEqual([
      { name: "인자", default: "a", description: "b" },
    ]);
    // 설명 안의 `=` 도 그냥 글자다 (이름 뒤 첫 구분자가 `|` 였으므로 기본값은 없다).
    expect(placeholdersOf("run {{인자|x=y}}")).toEqual([{ name: "인자", description: "x=y" }]);
  });

  it("이름이 겹치면 **처음 것의 기본값·설명**이 이긴다", () => {
    expect(placeholdersOf("ssh {{호스트=web-01|어디}} 그리고 {{호스트=db-01}}")).toEqual([
      { name: "호스트", default: "web-01", description: "어디" },
    ]);
  });

  it("이름이 비면 기본값이 붙어 있어도 자리표시자가 아니다", () => {
    expect(placeholdersOf("echo {{=기본값}} {{ |설명}}")).toEqual([]);
  });
});

describe("defaultValuesOf", () => {
  it("기본값이 적힌 칸만 미리 채운다", () => {
    expect(defaultValuesOf(placeholdersOf("df -h {{경로=/var}} {{옵션}}"))).toEqual({
      경로: "/var",
    });
  });

  it("기본값이 하나도 없으면 빈 표다", () => {
    expect(defaultValuesOf(placeholdersOf("ssh {{호스트}}"))).toEqual({});
  });
});

describe("renderSnippet", () => {
  it("모든 자리에 같은 값을 넣는다", () => {
    expect(renderSnippet("cp {{f}} /tmp/{{f}}", { f: "a.txt" })).toBe("cp a.txt /tmp/a.txt");
  });

  it("값이 없는 칸은 빈 글자가 된다 — 토큰을 그대로 흘리지 않는다", () => {
    expect(renderSnippet("echo {{없음}}!", {})).toBe("echo !");
  });

  it("공백이 든 토큰도 같은 이름으로 찾는다", () => {
    expect(renderSnippet("ssh {{ 호스트 }}", { 호스트: "web-01" })).toBe("ssh web-01");
  });

  it("치환은 한 번뿐이다 — 넣은 값 안의 토큰은 다시 풀리지 않는다", () => {
    expect(renderSnippet("echo {{a}}", { a: "{{b}}", b: "폭발" })).toBe("echo {{b}}");
  });

  it("빈 명령은 빈 글자다", () => {
    expect(renderSnippet("", {})).toBe("");
    expect(renderSnippet(undefined, {})).toBe("");
  });

  it("기본값·설명이 붙은 토큰도 **이름으로** 찾는다", () => {
    expect(renderSnippet("df -h {{경로=/var|어느 경로를 볼지}}", { 경로: "/home" })).toBe(
      "df -h /home",
    );
  });

  it("기본값은 여기서 되살아나지 않는다 — 사람이 지운 칸은 지운 대로 나간다", () => {
    expect(renderSnippet("df -h {{경로=/var}}", {})).toBe("df -h ");
    expect(renderSnippet("df -h {{경로=/var}}", { 경로: "" })).toBe("df -h ");
  });
});

describe("parseSnippets", () => {
  const file = (body: string) => `{"version":1,"snippets":[${body}]}`;

  it("정상 파일을 그대로 읽는다", () => {
    const parsed = parseSnippets(
      file(
        `{"id":"S1","name":"이름","command":"ls","description":"설명","scope":{"kind":"host","alias":"web-01"},"enter":false}`,
      ),
    );
    expect(parsed?.snippets).toEqual([
      {
        id: "S1",
        name: "이름",
        command: "ls",
        description: "설명",
        scope: { kind: "host", alias: "web-01" },
        enter: false,
      },
    ]);
  });

  it("깨진 JSON · 모르는 버전 · 배열 아님은 전부 null", () => {
    expect(parseSnippets("{이건 JSON 이 아니다")).toBeNull();
    expect(parseSnippets(`{"version":2,"snippets":[]}`)).toBeNull();
    expect(parseSnippets(`{"version":1,"snippets":{}}`)).toBeNull();
    expect(parseSnippets("")).toBeNull();
    expect(parseSnippets(null)).toBeNull();
  });

  it("깨진 줄만 버리고 나머지는 살린다", () => {
    const parsed = parseSnippets(
      file(
        [
          `{"id":"","name":"id 없음","command":"ls"}`,
          `{"id":"S2","name":"","command":"ls"}`,
          `{"id":"S3","name":"명령 없음","command":"  "}`,
          `{"id":"S4","name":"살아남는다","command":"ls"}`,
          `{"id":"S4","name":"id 중복","command":"pwd"}`,
          `null`,
        ].join(","),
      ),
    );
    expect(parsed?.snippets.map((s) => s.name)).toEqual(["살아남는다"]);
  });

  it("범위를 못 알아보면 '모든 호스트' 로 떨어뜨린다 (줄을 버리지 않는다)", () => {
    const parsed = parseSnippets(
      file(
        [
          `{"id":"A","name":"a","command":"ls","scope":{"kind":"host"}}`,
          `{"id":"B","name":"b","command":"ls","scope":"이상함"}`,
          `{"id":"C","name":"c","command":"ls"}`,
        ].join(","),
      ),
    );
    expect(parsed?.snippets.map((s) => s.scope)).toEqual([
      { kind: "all" },
      { kind: "all" },
      { kind: "all" },
    ]);
  });

  it("enter 는 명시적 false 일 때만 꺼진다", () => {
    const parsed = parseSnippets(
      file(
        [
          `{"id":"A","name":"a","command":"ls","enter":false}`,
          `{"id":"B","name":"b","command":"ls","enter":"아니오"}`,
          `{"id":"C","name":"c","command":"ls"}`,
        ].join(","),
      ),
    );
    expect(parsed?.snippets.map((s) => s.enter)).toEqual([false, true, true]);
  });

  it("빈 설명은 키 자체를 만들지 않는다", () => {
    const parsed = parseSnippets(file(`{"id":"A","name":"a","command":"ls","description":"  "}`));
    expect(parsed?.snippets[0]).not.toHaveProperty("description");
  });

  it("상한을 넘으면 거기서 끊는다", () => {
    const rows = Array.from(
      { length: MAX_SNIPPETS + 5 },
      (_, i) => `{"id":"S${i}","name":"n${i}","command":"ls"}`,
    ).join(",");
    expect(parseSnippets(file(rows))?.snippets).toHaveLength(MAX_SNIPPETS);
  });

  it("직렬화 → 파싱 왕복이 같은 목록이다", () => {
    const list = [
      snip({ id: "A", scope: { kind: "host", alias: "web-01" }, description: "설명" }),
      snip({ id: "B", enter: false }),
    ];
    const json = JSON.stringify(serializeSnippets(list));
    expect(parseSnippets(json)?.snippets).toEqual(list);
  });

  it("같은 목록이면 같은 문자열이다 (저장 생략 판정이 여기 걸려 있다)", () => {
    const list = [snip()];
    expect(JSON.stringify(serializeSnippets(list))).toBe(
      JSON.stringify(serializeSnippets([{ ...list[0] }])),
    );
  });
});

describe("목록 조작", () => {
  it("withSnippet 은 앞에 붙이고, 같은 id 는 갈아 끼운다", () => {
    const a = snip({ id: "A" });
    const b = snip({ id: "B" });
    expect(withSnippet([a], b).map((s) => s.id)).toEqual(["B", "A"]);
    const a2 = snip({ id: "A", name: "바뀜" });
    expect(withSnippet([a, b], a2)).toEqual([a2, b]);
  });

  it("withoutSnippet 은 없는 id 에 조용하다", () => {
    const a = snip({ id: "A" });
    expect(withoutSnippet([a], "없음")).toEqual([a]);
    expect(withoutSnippet([a], "A")).toEqual([]);
  });

  it("updateSnippet 은 자리를 지킨다", () => {
    const list = [snip({ id: "A" }), snip({ id: "B" }), snip({ id: "C" })];
    const next = updateSnippet(list, "B", { name: "고침" });
    expect(next?.map((s) => s.id)).toEqual(["A", "B", "C"]);
    expect(next?.[1].name).toBe("고침");
  });

  it("updateSnippet 은 없는 id · 빈 이름 · 빈 명령에 null", () => {
    const list = [snip()];
    expect(updateSnippet(list, "없음", { name: "x" })).toBeNull();
    expect(updateSnippet(list, "S1", { name: "   " })).toBeNull();
    expect(updateSnippet(list, "S1", { command: "" })).toBeNull();
  });

  it("updateSnippet 으로 설명을 비우면 키가 사라진다", () => {
    const list = [snip({ description: "있음" })];
    const next = updateSnippet(list, "S1", { description: "  " });
    expect(next?.[0]).not.toHaveProperty("description");
  });
});

describe("snippetsForScope", () => {
  const all = snip({ id: "A", scope: { kind: "all" } });
  const web = snip({ id: "W", scope: { kind: "host", alias: "web-01" } });
  const db = snip({ id: "D", scope: { kind: "host", alias: "db-01" } });
  const list = [all, web, db];

  it("별칭이 없으면(로컬 셸) 호스트 스니펫은 하나도 안 걸린다", () => {
    expect(snippetsForScope(list, null).map((s) => s.id)).toEqual(["A"]);
    expect(snippetsForScope(list, "  ").map((s) => s.id)).toEqual(["A"]);
  });

  it("그 별칭의 것과 '모든 호스트' 만 남고 순서는 그대로다", () => {
    expect(snippetsForScope(list, "web-01").map((s) => s.id)).toEqual(["A", "W"]);
  });
});

describe("withRenamedHostScope — 호스트 이름 변경을 따라간다", () => {
  const all = snip({ id: "A", scope: { kind: "all" } });
  const web = snip({ id: "W", scope: { kind: "host", alias: "web-01" } });
  const db = snip({ id: "D", scope: { kind: "host", alias: "db-01" } });

  it("그 별칭의 줄만 새 이름으로 옮기고 순서·나머지 칸은 그대로다", () => {
    const next = withRenamedHostScope([all, web, db], "web-01", "web-02");
    expect(next?.map((s) => [s.id, s.scope])).toEqual([
      ["A", { kind: "all" }],
      ["W", { kind: "host", alias: "web-02" }],
      ["D", { kind: "host", alias: "db-01" }],
    ]);
    // 손대지 않은 줄은 **객체째** 그대로다 (공연히 새로 만들지 않는다)
    expect(next?.[0]).toBe(all);
    expect(next?.[2]).toBe(db);
  });

  it("찾는 것은 대소문자를 무시하고, 적히는 글자는 사람이 친 그대로다", () => {
    const next = withRenamedHostScope([snip({ scope: { kind: "host", alias: "WEB-01" } })], "web-01", " SSH ");
    expect(next?.[0].scope).toEqual({ kind: "host", alias: "SSH" });
  });

  it("바꿀 줄이 없거나 이름이 비면 `null` — 부르는 쪽이 파일 쓰기를 건너뛴다", () => {
    expect(withRenamedHostScope([all, db], "web-01", "web-02")).toBeNull();
    expect(withRenamedHostScope([web], "web-01", "  ")).toBeNull();
    expect(withRenamedHostScope([web], "", "web-02")).toBeNull();
  });
});

describe("팔레트 API", () => {
  // 붙는 말("스니펫: ")은 여기 없다 — 순수 층은 화면 언어를 모르고, 그 낱말은 팔레트가
  // 사전에서 꺼내 앞에 얹는다 (`commands.palette.snippet.row`).
  it("이름은 그대로, 부연은 명령 미리보기다", () => {
    const [entry] = snippetPaletteEntries([snip()], null);
    expect(entry).toEqual({
      id: "S1",
      name: "상태 보기",
      detail: "systemctl status nginx",
      command: "systemctl status nginx",
      keywords: expect.stringContaining("상태 보기"),
    });
  });

  it("범위를 그대로 지킨다 — 포커스가 다른 호스트면 목록에 없다", () => {
    const list = [snip({ id: "W", scope: { kind: "host", alias: "web-01" } })];
    expect(snippetPaletteEntries(list, null)).toEqual([]);
    expect(snippetPaletteEntries(list, "db-01")).toEqual([]);
    expect(snippetPaletteEntries(list, "web-01")).toHaveLength(1);
  });

  it("검색 글자에 이름·명령·설명·별칭이 전부 든다", () => {
    const [entry] = snippetPaletteEntries(
      [
        snip({
          name: "재시작",
          command: "systemctl restart nginx",
          description: "무중단 아님",
          scope: { kind: "host", alias: "web-01" },
        }),
      ],
      "web-01",
    );
    for (const part of ["재시작", "nginx", "무중단", "web-01"]) {
      expect(entry.keywords).toContain(part);
    }
  });

  // 이 글자는 **두 곳이 같이 알아야** 한다 — 거르는 팔레트(`CommandPalette.svelte` 의
  // `wants`)와 미리 채우는 액션(`openSnippetPalette`). 팔레트가 이미 쥔 셋 중 하나로
  // 바뀌면 그 섹션이 통째로 사라지는데, 화면에는 "결과가 없습니다" 만 남아 흔적이 없다.
  it("팔레트 접두사는 한 글자이고 다른 접두사와 겹치지 않는다", () => {
    expect(SNIPPET_QUERY_PREFIX).toHaveLength(1);
    expect([">", "@", "#"]).not.toContain(SNIPPET_QUERY_PREFIX);
  });
});

describe("snippetPreview", () => {
  it("줄바꿈·연속 공백을 하나로 접는다", () => {
    expect(snippetPreview("echo a\n\n  echo b")).toBe("echo a echo b");
  });

  it("길면 잘라 '…' 를 붙이고 상한을 넘지 않는다", () => {
    const long = "x".repeat(SNIPPET_PREVIEW_CHARS + 20);
    const out = snippetPreview(long);
    expect(out).toHaveLength(SNIPPET_PREVIEW_CHARS);
    expect(out.endsWith("…")).toBe(true);
  });

  it("상한 이하면 그대로 둔다", () => {
    expect(snippetPreview("ls")).toBe("ls");
  });
});

// ---------------------------------------------------------------------------
// 이미 친 명령 → 스니펫 (docs/log/2026-09-16-snippets.md)
// ---------------------------------------------------------------------------

describe("defaultSnippetName", () => {
  it("상한 이하면 명령을 그대로 쓴다", () => {
    expect(defaultSnippetName("ls -la")).toBe("ls -la");
  });

  it("여러 줄·연속 공백은 한 줄로 접는다", () => {
    expect(defaultSnippetName("git add .\n  git commit")).toBe("git add . git commit");
  });

  it("상한을 넘으면 **낱말 경계**에서 끊는다", () => {
    // 30자 안쪽의 마지막 공백까지만 남는다 ("docker compose -f docker-compose…" 가 아니다)
    expect(defaultSnippetName("docker compose -f docker-compose.prod.yml up -d")).toBe(
      "docker compose -f",
    );
  });

  it("낱말 경계가 없으면 그 자리에서 자른다 — 빈 이름보다 낫다", () => {
    const one = "x".repeat(SNIPPET_NAME_CUT + 20);
    expect(defaultSnippetName(one)).toBe("x".repeat(SNIPPET_NAME_CUT));
  });

  it("어떤 경우에도 상한을 넘지 않는다", () => {
    for (const cmd of ["a".repeat(200), "sudo systemctl restart nginx-really-long-unit.service"]) {
      expect(defaultSnippetName(cmd).length).toBeLessThanOrEqual(SNIPPET_NAME_CUT);
    }
  });

  it("글자를 손대지 않는다 — `sudo` 도 그대로 남는다 (초안이지 해석이 아니다)", () => {
    expect(defaultSnippetName("sudo reboot")).toBe("sudo reboot");
  });

  it("빈 값·문자열이 아닌 값은 빈 이름이다", () => {
    expect(defaultSnippetName("")).toBe("");
    expect(defaultSnippetName(null)).toBe("");
    expect(defaultSnippetName(undefined)).toBe("");
    expect(defaultSnippetName("   \n  ")).toBe("");
  });
});

describe("snippetSaveLabel", () => {
  it("안 잘렸으면 이름과 **같은 글자**다 (말줄임표가 없다)", () => {
    expect(snippetSaveLabel("ls -la")).toBe("ls -la");
  });

  it("잘렸으면 `…` 가 붙는다 — 이름 쪽에는 안 붙는다", () => {
    const cmd = "docker compose -f docker-compose.prod.yml up -d";
    expect(snippetSaveLabel(cmd)).toBe("docker compose -f…");
    expect(defaultSnippetName(cmd)).toBe("docker compose -f");
  });
});

describe("shouldOfferSave", () => {
  it("세 글자 미만이면 세우지 않는다 (좁히려고 친 글자다)", () => {
    expect(shouldOfferSave("", [])).toBe(false);
    expect(shouldOfferSave("ls", [])).toBe(false);
    expect(shouldOfferSave("  l  ", [])).toBe(false);
  });

  it("세 글자 이상이고 같은 명령이 없으면 세운다", () => {
    expect(shouldOfferSave("ls -la", [])).toBe(true);
    expect(shouldOfferSave("ls -la", ["systemctl status nginx"])).toBe(true);
  });

  it("**맞는 결과가 있어도** 세운다 — 통째로 친 명령을 남길 길이 있어야 한다", () => {
    expect(shouldOfferSave("tail -f /var/log/syslog", ["tail -f /var/log/nginx/error.log"])).toBe(
      true,
    );
  });

  it("같은 명령의 스니펫이 이미 있으면 세우지 않는다 (앞뒤 공백은 무시)", () => {
    expect(shouldOfferSave("ls -la", ["ls -la"])).toBe(false);
    expect(shouldOfferSave("  ls -la  ", ["ls -la"])).toBe(false);
    expect(shouldOfferSave("ls -la", ["  ls -la\n"])).toBe(false);
  });
});

describe("suggestSnippets — 입력 중 제안", () => {
  const nginx = snip({ id: "S1", name: "nginx 상태", command: "systemctl status nginx" });
  const deploy = snip({ id: "S2", name: "배포", command: "./deploy.sh --prod" });
  const logs = snip({ id: "S3", name: "로그 꼬리", command: "tail -f /var/log/syslog" });
  const all = [nginx, deploy, logs];

  it("두 글자 미만이면 아무것도 없다", () => {
    expect(suggestSnippets("", all, null)).toEqual([]);
    expect(suggestSnippets("s", all, null)).toEqual([]);
    expect(suggestSnippets("  s  ", all, null)).toEqual([]);
  });

  it("명령 접두사가 먼저, 부분수열이 그다음", () => {
    // `sys` 는 "systemctl …" 의 접두사이자 "…/var/log/syslog" 의 부분수열이다.
    expect(suggestSnippets("sys", all, null).map((s) => s.id)).toEqual(["S1", "S3"]);
  });

  it("이름 접두사로도 걸린다 (대소문자 무시)", () => {
    expect(suggestSnippets("NGINX", all, null).map((s) => s.id)).toEqual(["S1"]);
  });

  it("접두사가 부분수열보다 **위**에 선다", () => {
    const tl = snip({ id: "S4", name: "타일", command: "tmux list-sessions" });
    // `tl` → "tmux list-sessions" 는 부분수열, "tl..." 로 시작하는 것은 없다
    const only = suggestSnippets("tl", [tl], null);
    expect(only.map((s) => s.id)).toEqual(["S4"]);
    // 같은 질의에 접두사 하나를 더하면 그쪽이 앞선다
    const tlPrefix = snip({ id: "S5", name: "tls 확인", command: "openssl s_client" });
    expect(suggestSnippets("tl", [tl, tlPrefix], null).map((s) => s.id)).toEqual(["S5", "S4"]);
  });

  it("맞는 것이 없으면 빈 배열", () => {
    expect(suggestSnippets("zzz", all, null)).toEqual([]);
  });

  it("명령이 **이미 똑같으면** 뺀다 — 넣어 줄 것이 없다", () => {
    expect(suggestSnippets("./deploy.sh --prod", all, null)).toEqual([]);
    expect(suggestSnippets("  ./deploy.sh --prod  ", all, null)).toEqual([]);
    // 한 글자만 모자라면 그대로 선다
    expect(suggestSnippets("./deploy.sh --pro", all, null).map((s) => s.id)).toEqual(["S2"]);
  });

  it("범위를 지난다 — 별칭이 없으면 호스트 스니펫은 안 걸린다", () => {
    const hostOnly = snip({
      id: "S9",
      name: "재시작",
      command: "systemctl restart web",
      scope: { kind: "host", alias: "web-01" },
    });
    expect(suggestSnippets("sys", [hostOnly], null)).toEqual([]);
    expect(suggestSnippets("sys", [hostOnly], "db-01")).toEqual([]);
    expect(suggestSnippets("sys", [hostOnly], "web-01").map((s) => s.id)).toEqual(["S9"]);
  });

  it("상한을 지킨다", () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      snip({ id: `S${i}`, name: `배포 ${i}`, command: `./deploy-${i}.sh` }),
    );
    expect(suggestSnippets("./dep", many, null)).toHaveLength(SNIPPET_SUGGEST_LIMIT);
    expect(suggestSnippets("./dep", many, null, 2)).toHaveLength(2);
    expect(suggestSnippets("./dep", many, null, 0)).toEqual([]);
  });

  it("줄에 실리는 것은 이름 · 미리보기 · 명령 원문이다", () => {
    const long = snip({
      id: "SL",
      name: "긴 것",
      command: `echo ${"x".repeat(200)}`,
    });
    const [row] = suggestSnippets("echo", [long], null);
    expect(row.id).toBe("SL");
    expect(row.name).toBe("긴 것");
    expect(row.command).toBe(long.command); // 원문은 안 자른다 (넣을 것이다)
    expect(row.preview).toHaveLength(SNIPPET_SUGGEST_PREVIEW_CHARS);
    expect(row.preview.endsWith("…")).toBe(true);
  });
});
