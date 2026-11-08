import { describe, expect, it } from "vitest";
import { headingLines, parseMarkdown, type MdBlock, type MdInline } from "$lib/markdown";
import { sectionLines } from "$lib/doc-edit-preview";
import { outlineOf } from "$lib/doc-outline";
import { imageSrcsOf } from "$lib/doc-images";

const txt = (text: string): MdInline => ({ kind: "text", text });
const ref = (id: string, n: number, occ = 1): MdInline => ({ kind: "fnref", text: String(n), id, n, occ });
const fnsOf = (bs: MdBlock[]) => {
  const last = bs[bs.length - 1];
  return last?.kind === "footnotes" ? last.items : null;
};

describe("각주 — 참조 · 정의", () => {
  it("첫 참조 순서로 번호 · 정의 줄은 본문에서 빠지고 글 끝 구역", () => {
    const b = parseMarkdown("가[^b] 나[^a]\n\n[^a]: 에이\n[^b]: 비\n");
    expect(b[0]).toEqual({ kind: "p", inlines: [txt("가"), ref("b", 1), txt(" 나"), ref("a", 2)] });
    expect(b).toHaveLength(2);
    expect(fnsOf(b)).toEqual([
      { n: 1, id: "b", inlines: [txt("비")], refs: 1 },
      { n: 2, id: "a", inlines: [txt("에이")], refs: 1 },
    ]);
  });

  it("같은 각주를 여러 번 — 번호는 같고 몇째 참조인지 센다", () => {
    const b = parseMarkdown("x[^1] y[^1]\n\n[^1]: 하나\n");
    expect(b[0]).toEqual({ kind: "p", inlines: [txt("x"), ref("1", 1, 1), txt(" y"), ref("1", 1, 2)] });
    expect(fnsOf(b)?.[0].refs).toBe(2);
  });

  it("정의 없는 참조는 글자 그대로 · 참조 없는 정의는 보이지 않는다", () => {
    const b = parseMarkdown("가[^없음] 나\n\n[^외톨이]: 아무도 안 부름\n");
    expect(b).toEqual([{ kind: "p", inlines: [txt("가[^없음] 나")] }]);
  });

  it("이름은 대소문자를 가리지 않는다 · 공백 있는 이름은 각주가 아니다", () => {
    const b = parseMarkdown("a[^Note]\n\n[^note]: 글\n");
    expect(b[0]).toEqual({ kind: "p", inlines: [txt("a"), ref("note", 1)] });
    expect(parseMarkdown("a[^x y]\n\n[^x y]: 글\n")[0]).toEqual({ kind: "p", inlines: [txt("a[^x y]")] });
  });

  it("들여 쓴 이어짐 줄은 같은 각주 · 빈 줄 뒤는 본문", () => {
    const b = parseMarkdown("a[^1]\n\n[^1]: 첫 줄\n    둘째 **줄**\n\n    뒤 문단\n");
    expect(fnsOf(b)?.[0].inlines).toEqual([txt("첫 줄\n둘째 "), { kind: "strong", text: "줄" }]);
    // 빈 줄 뒤 들여 쓴 줄은 잃지 않는다(본문 문단)
    expect(b.some((x) => x.kind === "p" && x.inlines.some((i) => i.text.includes("뒤 문단")))).toBe(true);
  });

  it("각주 안의 참조가 새 각주를 부른다 — 번호가 이어진다", () => {
    const b = parseMarkdown("a[^1]\n\n[^1]: 하나[^2]\n[^2]: 둘\n");
    const items = fnsOf(b)!;
    expect(items.map((x) => x.id)).toEqual(["1", "2"]);
    expect(items[0].inlines).toEqual([txt("하나"), ref("2", 2)]);
  });

  it("코드 안 · 울타리 안은 각주가 아니다", () => {
    const b = parseMarkdown("`[^1]` 와 [^1]\n\n```\n[^1]: 코드\n```\n\n[^1]: 진짜\n");
    expect(b[0]).toEqual({ kind: "p", inlines: [{ kind: "code", text: "[^1]" }, txt(" 와 "), ref("1", 1)] });
    expect(b[1]).toEqual({ kind: "code", lang: "", text: "[^1]: 코드" });
    expect(fnsOf(b)?.[0].inlines).toEqual([txt("진짜")]);
  });

  it("인용 · 목록 · 표 속 참조도 글 순서대로", () => {
    const b = parseMarkdown("> q[^b]\n\n- l[^a]\n\n[^a]: A\n[^b]: B\n");
    expect(fnsOf(b)?.map((x) => x.id)).toEqual(["b", "a"]);
  });

  it("참조 링크 정의와 섞여도 각자", () => {
    const b = parseMarkdown("[문서][d] 와 각주[^d]\n\n[d]: https://a.io\n[^d]: 각주 글\n");
    expect(b[0]).toEqual({
      kind: "p",
      inlines: [{ kind: "link", text: "문서", href: "https://a.io" }, txt(" 와 각주"), ref("d", 1)],
    });
  });
});

describe("각주 — 다른 소비처와의 짝", () => {
  it("각주 구역은 목차에 들지 않는다", () => {
    const src = "# 제목[^1]\n\n본문\n\n[^1]: 글\n";
    const b = parseMarkdown(src);
    expect(outlineOf(b).map((o) => o.text)).toEqual(["제목1"]);
  });

  it("headingLines 와 parseLines 의 짝 — 이어짐 줄의 `# …` 는 제목이 아니다", () => {
    const src = "# 하나\n\n[^1]: 글\n  # 이어짐\n\n# 둘\n\n참조[^1]\n";
    const b = parseMarkdown(src);
    expect(headingLines(src).map((h) => h.line)).toEqual([0, 5]);
    expect(sectionLines(src, b).map((s) => s.line)).toEqual([0, 5]);
  });

  it("각주 속 그림도 그림 주소 목록에", () => {
    expect(imageSrcsOf(parseMarkdown("a[^1]\n\n[^1]: ![g](img/a.png)\n"))).toEqual(["img/a.png"]);
  });
});
