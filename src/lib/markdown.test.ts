import { describe, expect, it } from "vitest";
import { isWebUrl, linkHost, linkUrlTail, parseInline, parseMarkdown, refKey, splitRow, type MdBlock, type MdInline } from "$lib/markdown";

const txt = (text: string): MdInline => ({ kind: "text", text });
/** 토막들의 보이는 글자를 이어 붙인다 — "잃는 것이 없다" 를 볼 때 */
const flat = (xs: MdInline[]) => xs.map((x) => x.text).join("");

describe("parseInline — 기울임", () => {
  it("별표 하나 · 밑줄 하나", () => {
    expect(parseInline("a *b* c _d_ e")).toEqual([txt("a "), { kind: "em", text: "b" }, txt(" c "), { kind: "em", text: "d" }, txt(" e")]);
  });

  it("굵게는 그대로 굵게", () => {
    expect(parseInline("**bold** and *it*")).toEqual([{ kind: "strong", text: "bold" }, txt(" and "), { kind: "em", text: "it" }]);
  });

  it("snake_case 와 foo__bar__baz 는 글자", () => {
    expect(parseInline("call snake_case_name now")).toEqual([txt("call snake_case_name now")]);
    expect(parseInline("foo__bar__baz")).toEqual([txt("foo__bar__baz")]);
  });

  it("곱셈 · 글롭은 글자", () => {
    expect(parseInline("2 * 3 * 4")).toEqual([txt("2 * 3 * 4")]);
    expect(parseInline("*.md and *.ts")).toEqual([txt("*.md and *.ts")]);
    expect(parseInline("**/*.ts and **/*.js")).toEqual([txt("**/*.ts and **/*.js")]);
  });

  it("역슬래시로 푼 표식은 글자 — 역슬래시 둘은 그대로", () => {
    expect(parseInline("\\*not\\* \\\\server")).toEqual([txt("*not* \\\\server")]);
  });
});

describe("parseInline — 굵게 · 기울임 · 취소선의 안쪽", () => {
  const link = (text: string, href: string): MdInline => ({ kind: "link", text, href });
  const code = (text: string): MdInline => ({ kind: "code", text });

  it("굵은 글 안의 링크 — 굵은 링크 + 굵은 나머지", () => {
    expect(parseInline("**[a](https://u.io)b**")).toEqual([
      { kind: "strong", text: "ab", inlines: [link("a", "https://u.io"), txt("b")] },
    ]);
  });

  it("실제 기록 — 굵은 문장 첫머리의 링크", () => {
    const src =
      "**[Context7](https://context7.com/docs/overview)은 AI 코딩 도우미가 최신 라이브러리 문서와 코드 예제를 찾아 참고하도록 해주는 서비스입니다.** 쉽게 말하면 …";
    const rest = "은 AI 코딩 도우미가 최신 라이브러리 문서와 코드 예제를 찾아 참고하도록 해주는 서비스입니다.";
    expect(parseInline(src)).toEqual([
      { kind: "strong", text: `Context7${rest}`, inlines: [link("Context7", "https://context7.com/docs/overview"), txt(rest)] },
      txt(" 쉽게 말하면 …"),
    ]);
  });

  it("기울임 안의 코드 · 굵게 안의 기울임 · 기울임 안의 굵게", () => {
    expect(parseInline("*x `code` y*")).toEqual([{ kind: "em", text: "x code y", inlines: [txt("x "), code("code"), txt(" y")] }]);
    expect(parseInline("**a *b* c**")).toEqual([{ kind: "strong", text: "a b c", inlines: [txt("a "), { kind: "em", text: "b" }, txt(" c")] }]);
    expect(parseInline("*a **b** c*")).toEqual([{ kind: "em", text: "a b c", inlines: [txt("a "), { kind: "strong", text: "b" }, txt(" c")] }]);
  });

  it("별표 셋 — 굵은 기울임", () => {
    expect(parseInline("***a***")).toEqual([{ kind: "strong", text: "a", inlines: [{ kind: "em", text: "a" }] }]);
    expect(parseInline("**a *b***")).toEqual([{ kind: "strong", text: "a b", inlines: [txt("a "), { kind: "em", text: "b" }] }]);
    expect(parseInline("**a***")).toEqual([{ kind: "strong", text: "a" }, txt("*")]);
  });

  it("취소선 안의 링크 · 굵은 글 안의 그림", () => {
    expect(parseInline("~~[old](https://o.io)~~")).toEqual([{ kind: "del", text: "old", inlines: [link("old", "https://o.io")] }]);
    expect(parseInline("**![alt](a.png)**")).toEqual([{ kind: "strong", text: "alt", inlines: [{ kind: "image", text: "alt", href: "a.png" }] }]);
  });

  it("평문뿐이면 inlines 없음 · 닫히지 않은 ** 는 글자", () => {
    expect(parseInline("**bold**")).toEqual([{ kind: "strong", text: "bold" }]);
    expect(parseInline("**[a](https://u.io) b")).toEqual([txt("**"), link("a", "https://u.io"), txt(" b")]);
  });

  it("수식 선택이면 굵은 글 안의 수식도", () => {
    expect(parseInline("**$x$ 값**", { math: true })).toEqual([{ kind: "strong", text: "x 값", inlines: [{ kind: "math", text: "x" }, txt(" 값")] }]);
  });

  it("중첩 깊이 상한 — 그 아래는 평문", () => {
    const xs = parseInline("*a **b *c **d *e **f `g`** e* d** c* b** a*");
    let depth = 0;
    const walk = (ys: MdInline[], d: number) => {
      depth = Math.max(depth, d);
      for (const y of ys) if ((y.kind === "strong" || y.kind === "em" || y.kind === "del") && y.inlines) walk(y.inlines, d + 1);
    };
    walk(xs, 0);
    expect(depth).toBeLessThanOrEqual(4);
    expect(flat(xs)).toContain("a");
    expect(() => parseInline("**".repeat(5000) + "a" + "**".repeat(5000))).not.toThrow();
  });
});

describe("parseInline — 취소선", () => {
  const del = (text: string): MdInline => ({ kind: "del", text });

  it("물결 둘 짝이면 취소선", () => {
    expect(parseInline("a ~~b c~~ d")).toEqual([txt("a "), del("b c"), txt(" d")]);
    expect(parseInline("~~old~~new")).toEqual([del("old"), txt("new")]);
  });

  it("물결 하나 · 셋은 글자", () => {
    expect(parseInline("~/x and ~y~")).toEqual([txt("~/x and ~y~")]);
    expect(parseInline("~~~a~~~")).toEqual([txt("~~~a~~~")]);
  });

  it("짝이 없으면 글자 — 여는 짝 뒤 · 닫는 짝 앞이 공백이면 짝이 아니다", () => {
    expect(parseInline("a ~~b")).toEqual([txt("a ~~b")]);
    expect(parseInline("~~ a ~~")).toEqual([txt("~~ a ~~")]);
    expect(parseInline("~~a ~~ b~~")).toEqual([del("a ~~ b")]);
  });

  it("인라인 코드 안의 물결은 표식이 아니다", () => {
    expect(parseInline("`~~a~~` b")).toEqual([{ kind: "code", text: "~~a~~" }, txt(" b")]);
    // 닫는 짝을 코드 안에서 찾지 않는다
    expect(parseInline("~~a `x~~` b~~")).toEqual([{ kind: "del", text: "a x~~ b", inlines: [txt("a "), { kind: "code", text: "x~~" }, txt(" b")] }]);
    expect(flat(parseInline("~~a `x~~`"))).toBe("~~a x~~");
  });

  it("역슬래시로 푼 물결은 짝이 아니다", () => {
    expect(parseInline("\\~~a~~")).toEqual([txt("~~a~~")]);
    expect(parseInline("~~a\\~~ b~~")).toEqual([del("a~~ b")]);
  });
});

describe("parseInline — 링크 · 그림", () => {
  it("링크는 글자 + 주소", () => {
    expect(parseInline("see [docs](https://x.dev/a_(b)) now")).toEqual([
      txt("see "),
      { kind: "link", text: "docs", href: "https://x.dev/a_(b)" },
      txt(" now"),
    ]);
  });

  it("제목이 붙은 링크 · 꺾쇠 주소", () => {
    expect(parseInline('[a](https://a.io "T")')).toEqual([{ kind: "link", text: "a", href: "https://a.io" }]);
    expect(parseInline("[a](<my file.md>)")).toEqual([{ kind: "link", text: "a", href: "my file.md" }]);
  });

  it("그림은 대체 글자만 · 배지 링크", () => {
    expect(parseInline("![logo](img/logo.png)")).toEqual([{ kind: "image", text: "logo", href: "img/logo.png" }]);
    expect(parseInline("[![build](https://ci/badge.svg)](https://ci/run)")).toEqual([
      { kind: "link", text: "build", href: "https://ci/run", image: true },
    ]);
  });

  it("자동 링크 · 맨 주소 (뒤 문장 부호는 뗀다)", () => {
    expect(parseInline("<https://a.io/x>")).toEqual([{ kind: "link", text: "https://a.io/x", href: "https://a.io/x" }]);
    expect(parseInline("go to https://a.io/x.")).toEqual([txt("go to "), { kind: "link", text: "https://a.io/x", href: "https://a.io/x" }, txt(".")]);
  });

  it("짝 없는 대괄호는 글자", () => {
    expect(parseInline("a [b] c [d](")).toEqual([txt("a [b] c [d](")]);
  });

  it("HTML 은 해석하지 않는다 — <script> · <img onerror> 는 글자", () => {
    const s = '<script>alert(1)</script> <img src=x onerror="alert(1)"> <a href="javascript:x">y</a>';
    expect(parseInline(s)).toEqual([txt(s)]);
    // 블록으로도 문단 글자
    expect(parseMarkdown(s)).toEqual([{ kind: "p", inlines: [txt(s)] }]);
  });

  it("javascript: 링크는 링크로 읽지만 열 수 있는 주소가 아니다", () => {
    expect(parseInline("[x](javascript:alert(1))")).toEqual([{ kind: "link", text: "x", href: "javascript:alert(1)" }]);
    expect(isWebUrl("javascript:alert(1)")).toBe(false);
  });
});

describe("isWebUrl", () => {
  it("http · https 만", () => {
    expect(isWebUrl("https://a.io")).toBe(true);
    expect(isWebUrl("HTTP://a.io/x")).toBe(true);
    expect(isWebUrl("file:///c:/x")).toBe(false);
    expect(isWebUrl("./README.md")).toBe(false);
    expect(isWebUrl("https://")).toBe(false);
  });
});

describe("parseMarkdown — 제목", () => {
  it("수준 1–6 · 밑줄식", () => {
    const b = parseMarkdown("###### six\n\nTitle\n=====\n\nSub\n---");
    expect(b).toEqual([
      { kind: "h", level: 6, inlines: [txt("six")] },
      { kind: "h", level: 1, inlines: [txt("Title")] },
      { kind: "h", level: 2, inlines: [txt("Sub")] },
    ]);
  });
});

describe("parseMarkdown — 체크박스 목록", () => {
  it("[ ] · [x] 는 checked, 보통 항목은 키 없음", () => {
    const b = parseMarkdown("- [ ] todo\n- [x] done\n- [X] Done\n- plain");
    expect(b).toEqual([
      {
        kind: "list",
        ordered: false,
        start: 1,
        items: [
          { depth: 0, inlines: [txt("todo")], checked: false, line: 0 },
          { depth: 0, inlines: [txt("done")], checked: true, line: 1 },
          { depth: 0, inlines: [txt("Done")], checked: true, line: 2 },
          { depth: 0, inlines: [txt("plain")] },
        ],
      },
    ]);
    const list = b[0] as Extract<MdBlock, { kind: "list" }>;
    expect("checked" in list.items[3]).toBe(false);
    expect("line" in list.items[3]).toBe(false);
  });

  it("뒤 글이 없어도 체크박스 — `- [ ]` · `- [x]` 만 (GitHub 과 같다)", () => {
    const list = parseMarkdown("- [ ]\n- [x]  \n- []")[0] as Extract<MdBlock, { kind: "list" }>;
    expect(list.items[0]).toMatchObject({ checked: false, line: 0 });
    expect(list.items[1]).toMatchObject({ checked: true, line: 1 });
    expect(list.items[0].inlines.map((s) => s.text).join("")).toBe("");
    // 대괄호 안이 비면 체크박스가 아니다
    expect("checked" in list.items[2]).toBe(false);
  });

  it("체크박스 항목의 원문 줄 — 앞의 블록 · 빈 줄 · 이어짐 줄 · CRLF 를 지나도 원문 기준", () => {
    const src = "# T\r\n\r\npara\r\n\r\n- [ ] a\r\n  more\r\n- [x] b\r\n";
    const list = parseMarkdown(src).find((b) => b.kind === "list") as Extract<MdBlock, { kind: "list" }>;
    expect(list.items.map((x) => x.line)).toEqual([4, 6]);
  });

  it("인용 · 알림 속 목록도 원문 줄", () => {
    const src = "intro\n\n> - [ ] q1\n> - [x] q2\n\n> [!NOTE]\n> - [ ] n1";
    const b = parseMarkdown(src);
    const quote = b[1] as Extract<MdBlock, { kind: "quote" }>;
    const ql = quote.blocks[0] as Extract<MdBlock, { kind: "list" }>;
    expect(ql.items.map((x) => x.line)).toEqual([2, 3]);
    const alert = b[2] as Extract<MdBlock, { kind: "alert" }>;
    const al = alert.blocks[0] as Extract<MdBlock, { kind: "list" }>;
    expect(al.items.map((x) => x.line)).toEqual([6]);
  });

  it("울타리 코드 · 참조 정의 줄 뒤에서도 어긋나지 않는다", () => {
    const src = "[id]: https://x\n```\n- [ ] no\n```\n- [ ] yes";
    const list = parseMarkdown(src).find((b) => b.kind === "list") as Extract<MdBlock, { kind: "list" }>;
    expect(list.items.map((x) => x.line)).toEqual([4]);
  });
});

describe("parseMarkdown — 표", () => {
  it("정렬 · 짧은 줄은 빈 칸 · 칸 안 인라인 · \\| 는 글자", () => {
    const b = parseMarkdown("| L | C | R |\n|:--|:-:|--:|\n| `x` | **y** | a\\|b |\n| 1 |");
    expect(b).toEqual([
      {
        kind: "table",
        align: ["left", "center", "right"],
        header: [[txt("L")], [txt("C")], [txt("R")]],
        rows: [
          [[{ kind: "code", text: "x" }], [{ kind: "strong", text: "y" }], [txt("a|b")]],
          [[txt("1")], [], []],
        ],
      },
    ]);
  });

  it("앞뒤 파이프 없는 표", () => {
    const b = parseMarkdown("a | b\n--- | ---\n1 | 2");
    expect(b[0].kind).toBe("table");
  });

  it("구분 줄이 없으면 지금처럼 고정폭 원문", () => {
    expect(parseMarkdown("| a | b |\n| c | d |")).toEqual([{ kind: "pre", text: "| a | b |\n| c | d |" }]);
  });

  it("머리와 구분 줄의 칸 수가 다르면 고정폭 원문", () => {
    expect(parseMarkdown("| a | b |\n|---|")).toEqual([{ kind: "pre", text: "| a | b |\n|---|" }]);
  });

  it("칸이 넘치는 줄이 있으면 자르지 않고 고정폭 원문", () => {
    const md = "| a | b |\n|---|---|\n| 1 | 2 | 3 |";
    expect(parseMarkdown(md)).toEqual([{ kind: "pre", text: md }]);
  });

  it("splitRow", () => {
    expect(splitRow("| a | b\\|c |")).toEqual(["a", "b|c"]);
    expect(splitRow("a|b")).toEqual(["a", "b"]);
  });
});

describe("parseMarkdown — 인용", () => {
  it("인용 안의 블록 · 중첩 인용", () => {
    const b = parseMarkdown("> # T\n> - a\n>\n> > inner\n> back");
    expect(b).toEqual([
      {
        kind: "quote",
        blocks: [
          { kind: "h", level: 1, inlines: [txt("T")] },
          { kind: "list", ordered: false, start: 1, items: [{ depth: 0, inlines: [txt("a")] }] },
          // 게으른 이어짐은 읽지 않는다 — `> back` 은 바깥 인용의 문단(글자는 그대로 남는다)
          { kind: "quote", blocks: [{ kind: "p", inlines: [txt("inner")] }] },
          { kind: "p", inlines: [txt("back")] },
        ],
      },
    ]);
  });

  it("아주 깊은 인용도 글자를 잃지 않는다", () => {
    const b = parseMarkdown(">".repeat(40) + " deep");
    let cur: MdBlock = b[0];
    let text = "";
    for (let n = 0; n < 50 && cur; n++) {
      if (cur.kind === "quote") cur = cur.blocks[0];
      else {
        if (cur.kind === "p") text = flat(cur.inlines);
        break;
      }
    }
    expect(text).toContain("deep");
  });
});

describe("parseMarkdown — GitHub 알림", () => {
  it("다섯 종류 · 대소문자 무시 · 앞뒤 공백 — 표식 줄은 빠지고 나머지가 본문", () => {
    for (const type of ["note", "tip", "important", "warning", "caution"] as const) {
      expect(parseMarkdown(`> [!${type.toUpperCase()}]\n> 본문`)).toEqual([
        { kind: "alert", type, blocks: [{ kind: "p", inlines: [txt("본문")] }] },
      ]);
    }
    expect(parseMarkdown(">  [!Note]  \n> a\n>\n> - b")).toEqual([
      {
        kind: "alert",
        type: "note",
        blocks: [
          { kind: "p", inlines: [txt("a")] },
          { kind: "list", ordered: false, start: 1, items: [{ depth: 0, inlines: [txt("b")] }] },
        ],
      },
    ]);
  });

  it("표식 줄에 다른 글이 있거나 모르는 종류 · 첫 줄이 아니면 일반 인용", () => {
    expect(parseMarkdown("> [!NOTE] 글\n> b")[0].kind).toBe("quote");
    expect(parseMarkdown("> [!INFO]\n> b")[0].kind).toBe("quote");
    expect(parseMarkdown("> b\n> [!NOTE]")[0].kind).toBe("quote");
  });

  it("표식 밑에 글이 없으면 일반 인용(표식은 글자)", () => {
    expect(parseMarkdown("> [!TIP]")).toEqual([{ kind: "quote", blocks: [{ kind: "p", inlines: [txt("[!TIP]")] }] }]);
  });

  it("중첩 인용 속 알림은 일반 인용 — GitHub 와 같이 최상위만", () => {
    expect(parseMarkdown("> > [!WARNING]\n> > x")).toEqual([
      { kind: "quote", blocks: [{ kind: "quote", blocks: [{ kind: "p", inlines: [txt("[!WARNING]\nx")] }] }] },
    ]);
  });
});

describe("parseMarkdown — 잃는 것이 없다", () => {
  it("모르는 문법(HTML 블록)은 문단 글자", () => {
    const md = "<details>\n<summary>x</summary>\n</details>";
    const b = parseMarkdown(md);
    expect(b.map((x) => (x.kind === "p" ? flat(x.inlines) : ""))).toEqual(["<details>\n<summary>x</summary>\n</details>"]);
  });
});

describe("linkUrlTail — 링크 뒤 흐린 주소 꼬리", () => {
  it("글자와 주소가 다르면 주소, 같으면 없음", () => {
    expect(linkUrlTail({ text: "문서", href: "https://x" })).toBe("https://x");
    expect(linkUrlTail({ text: "https://x", href: "https://x" })).toBeNull();
  });

  it("배지 링크(`[![alt](img)](url)`)는 꼬리가 없다 — 주소는 툴팁 몫", () => {
    const [badge] = parseInline("[![build](https://ci/badge.svg)](https://ci/run)");
    expect(badge).toEqual({ kind: "link", text: "build", href: "https://ci/run", image: true });
    if (badge.kind !== "link") throw new Error("link 여야 한다");
    expect(linkUrlTail(badge)).toBeNull();
  });
});

describe("linkHost — 출처 칩의 사이트 이름", () => {
  it("앞의 www. 만 떼고 경로·질의는 버린다", () => {
    expect(linkHost("https://www.rust-lang.org/learn?x=1#y")).toBe("rust-lang.org");
    expect(linkHost("HTTP://WWW.Example.COM")).toBe("example.com");
    expect(linkHost("https://docs.www.io/a")).toBe("docs.www.io");
  });

  it("포트는 남기고 사용자 정보는 뗀다", () => {
    expect(linkHost("http://localhost:5173/x")).toBe("localhost:5173");
    expect(linkHost("https://me:pw@www.a.io:8443/")).toBe("a.io:8443");
  });

  it("국제화 도메인은 적힌 그대로(퓨니코드로 바꾸지 않는다)", () => {
    expect(linkHost("https://www.한국.kr/길")).toBe("한국.kr");
    expect(linkHost("https://xn--3e0b707e.kr/")).toBe("xn--3e0b707e.kr");
  });

  it("주소로 읽히지 않으면 href 그대로", () => {
    expect(linkHost("https://")).toBe("https://");
    expect(linkHost("https://a b/")).toBe("https://a b/");
    expect(linkHost("./README.md")).toBe("./README.md");
  });
});

describe("참조 링크 — [글][id] · [글][] · [글] + [id]: 주소", () => {
  const p = (inlines: MdInline[]): MdBlock => ({ kind: "p", inlines });

  it("세 모양 모두 링크 — 정의 줄은 화면에서 빠진다", () => {
    const md = ["see [the docs][d] and [Guide][] or [guide].", "", "[d]: https://x.dev/docs", '[guide]: <https://x.dev/g> "Title"'].join("\n");
    const link = (text: string, href: string): MdInline => ({ kind: "link", text, href });
    expect(parseMarkdown(md)).toEqual([
      p([txt("see "), link("the docs", "https://x.dev/docs"), txt(" and "), link("Guide", "https://x.dev/g"), txt(" or "), link("guide", "https://x.dev/g"), txt(".")]),
    ]);
  });

  it("정의는 글 어디에 있어도 된다 — 앞에 있어도 · 목록 · 표 · 인용 · 제목 안의 참조도", () => {
    const md = ["[a]: https://a.io", "# [A][a]", "- [A][a]", "> [A][a]", "", "| x |", "| - |", "| [A][a] |"].join("\n");
    const a: MdInline = { kind: "link", text: "A", href: "https://a.io" };
    expect(parseMarkdown(md)).toEqual([
      { kind: "h", level: 1, inlines: [a] },
      { kind: "list", ordered: false, start: 1, items: [{ depth: 0, inlines: [a] }] },
      { kind: "quote", blocks: [p([a])] },
      { kind: "table", align: [null], header: [[txt("x")]], rows: [[[a]]] },
    ]);
  });

  it("이름은 대소문자 · 공백을 가리지 않고, 먼저 적힌 정의가 이긴다", () => {
    expect(refKey("  Foo   Bar ")).toBe("foo bar");
    const md = "[x][FOO  bar]\n\n[foo bar]: https://one\n[Foo Bar]: https://two";
    expect(parseMarkdown(md)).toEqual([p([{ kind: "link", text: "x", href: "https://one" }])]);
  });

  it("정의가 없으면 글자 그대로 — 흔한 대괄호 글이 링크로 둔갑하지 않는다", () => {
    expect(parseMarkdown("[x] and [y][z] and [w][]")).toEqual([p([txt("[x] and [y][z] and [w][]")])]);
    expect(parseMarkdown("[x] ok\n\n[y]: https://y")).toEqual([p([txt("[x] ok")])]);
  });

  it("배지 — [![alt][img]][link] 는 대체 글자만 서는 링크", () => {
    const md = "[![build][b]][ci]\n\n[b]: https://ci/badge.svg\n[ci]: https://ci/run";
    expect(parseMarkdown(md)).toEqual([p([{ kind: "link", text: "build", href: "https://ci/run", image: true }])]);
    expect(parseMarkdown("![logo][l]\n\n[l]: img/l.png")).toEqual([p([{ kind: "image", text: "logo", href: "img/l.png" }])]);
  });

  it("코드 블록 안의 정의 모양은 글자 · 각주 [^1]: 는 링크 정의가 아니다(각주 정의 — 참조가 없으면 보이지 않는다)", () => {
    const md = "```\n[a]: https://a.io\n```\n\n[^1]: note";
    expect(parseMarkdown(md)).toEqual([{ kind: "code", lang: "", text: "[a]: https://a.io" }]);
  });

  it("인라인 주소가 참조보다 먼저다", () => {
    expect(parseMarkdown("[a](https://in)\n\n[a]: https://ref")).toEqual([p([{ kind: "link", text: "a", href: "https://in" }])]);
  });

  it("parseInline 은 정의 없이 부르면 예전 그대로", () => {
    expect(parseInline("[a][b]")).toEqual([txt("[a][b]")]);
  });
});
