import { describe, expect, it } from "vitest";
import { chipOnly, placeSourceChips } from "$lib/md-source-chips";
import { linkHost, parseInline, type MdInline } from "$lib/markdown";

describe("chipOnly", () => {
  it("글자가 주소 · 사이트 이름 · 빈 글자면 참", () => {
    expect(chipOnly({ text: "https://github.com/a", href: "https://github.com/a" })).toBe(true);
    expect(chipOnly({ text: "github.com", href: "https://www.github.com/a" })).toBe(true);
    expect(chipOnly({ text: "www.github.com", href: "https://github.com/a" })).toBe(true);
    expect(chipOnly({ text: "  ", href: "https://github.com/a" })).toBe(true);
  });
  it("키워드면 거짓", () => {
    expect(chipOnly({ text: "저장소", href: "https://github.com/a" })).toBe(false);
  });
});

describe("placeSourceChips", () => {
  const web = (s: { href: string; image?: true }) => !s.image && /^https?:/.test(s.href);
  /** 토막들을 글로 — 키워드 링크 `[글]` · 칩 `{사이트|툴팁 글}` · 강조는 안쪽을 `*…*` 로 */
  const show = (xs: MdInline[]): string =>
    xs
      .map((s) =>
        s.kind === "link"
          ? s.source
            ? `{${linkHost(s.href)}|${s.text}}`
            : `[${s.text}]`
          : (s.kind === "strong" || s.kind === "em" || s.kind === "del") && s.inlines
            ? `*${show(s.inlines)}*`
            : s.text,
      )
      .join("");
  /** 본문(칩 포함) · 칩 수 */
  const run = (src: string) => {
    const out = placeSourceChips(parseInline(src), web);
    return { body: show(out), labels: out.filter((s) => s.kind === "link" && s.source).length, out };
  };

  it("괄호 출처 — 괄호를 지우고 그 자리 칩, 칩과 마침표 사이 공백 없음", () => {
    expect(run("Tauri 2 supports channels ([Tauri docs](https://v2.tauri.app/x)).").out).toEqual([
      { kind: "text", text: "Tauri 2 supports channels" },
      { kind: "link", text: "Tauri docs", href: "https://v2.tauri.app/x", source: true },
      { kind: "text", text: "." },
    ]);
  });

  it("괄호 안 여럿 — 칩 둘 제자리 · 뒤 문장은 그대로", () => {
    expect(run("채널을 지원합니다 ([A](https://a.com/1), [B](https://b.com/2)). 다음 문장").body).toBe(
      "채널을 지원합니다{a.com|A}{b.com|B}. 다음 문장",
    );
  });

  it("같은 주소 연달음은 칩 하나 · 툴팁 글자는 겹치지 않게 모은다 · 다른 주소(정확 일치만 같다)는 따로", () => {
    expect(run("끝 ([저장소](https://github.com/a), [여기](https://github.com/a), [저장소](https://github.com/a)).").body).toBe(
      "끝{github.com|저장소 · 여기}.",
    );
    expect(run("끝 ([a](https://github.com/a), [b](https://github.com/b), [c](https://github.com/a/)).").labels).toBe(3);
  });

  it("실제 기록 — 문장 끝 뒤 이름표는 그 자리 칩(툴팁에 이름표 글자)", () => {
    const r = run("Context7 는 최신 문서를 주는 MCP 서버이고, 버전별 문서를 고를 수 있다는 점이 핵심입니다. [공식 저장소](https://github.com/upstash/context7)");
    expect(r.body).toBe("Context7 는 최신 문서를 주는 MCP 서버이고, 버전별 문서를 고를 수 있다는 점이 핵심입니다.{github.com|공식 저장소}");
  });

  it("실제 기록 — `라벨: 링크 · 링크` 는 키워드 나열(`:` 는 문장 끝이 아니다)", () => {
    const r = run("키워드 링크: [React](https://react.dev/) · [Context7](https://context7.com/)");
    expect(r.body).toBe("키워드 링크: [React] · [Context7]");
    expect(r.labels).toBe(0);
  });

  it("문장 중간의 키워드 링크는 그대로", () => {
    const r = run("Tauri 2 의 [Channel API](https://v2.tauri.app/develop/calling-frontend/) 를 쓴다.");
    expect(r.body).toBe("Tauri 2 의 [Channel API] 를 쓴다.");
    expect(r.labels).toBe(0);
  });

  it("연달은 이름표 여럿 — 공백 · 구분자 사이 모두 그 자리 칩, 고아 구분자 없음", () => {
    expect(run("끝입니다. [A](https://a.com/x) [B](https://b.com/y)").body).toBe("끝입니다.{a.com|A}{b.com|B}");
    expect(run("끝입니다! [A](https://a.com/x) · [B](https://b.com/y)").body).toBe("끝입니다!{a.com|A}{b.com|B}");
    expect(run("끝인가요? [A](https://a.com/x), [B](https://b.com/y) · ").body).toBe("끝인가요?{a.com|A}{b.com|B}");
  });

  it("괄호 묶음 — 괄호를 지우고 칩만, 줄 중간이어도", () => {
    expect(run("설정이 필요합니다 ([공식 문서](https://docs.x.com/a)).").body).toBe("설정이 필요합니다{docs.x.com|공식 문서}.");
    expect(run("설정이 필요합니다. ([A](https://a.com/x), [B](https://b.com/y))").body).toBe("설정이 필요합니다.{a.com|A}{b.com|B}");
    expect(run("React ([공식 문서](https://react.dev/)) 기반이다.").body).toBe("React{react.dev|공식 문서} 기반이다.");
  });

  it("괄호 안에 글이 섞이면 키워드", () => {
    expect(run("Svelte (그리고 [SvelteKit](https://kit.svelte.dev/)) 를 쓴다.").body).toBe("Svelte (그리고 [SvelteKit]) 를 쓴다.");
  });

  it("문장 끝 뒤라도 같은 줄에 글이 이어지면 키워드(새 문장의 첫 낱말일 수 있다)", () => {
    expect(run("빠릅니다. [React](https://react.dev/) 기반 앱은 가볍다.").body).toBe("빠릅니다. [React] 기반 앱은 가볍다.");
  });

  it("줄바꿈 앞의 이름표는 그 자리 칩 · 줄바꿈과 다음 줄은 남는다", () => {
    expect(run("첫 문장입니다. [출처](https://a.com/x)\n다음 줄.").body).toBe("첫 문장입니다.{a.com|출처}\n다음 줄.");
  });

  it("블록 맨 앞 이름표 — 뒤가 줄바꿈이면 칩, 링크 하나뿐인 블록은 키워드 그대로", () => {
    expect(run("[출처](https://a.com/x)\n본문입니다.").body).toBe("{a.com|출처}\n본문입니다.");
    expect(run("[공식 문서](https://a.com/x)").body).toBe("[공식 문서]");
    expect(run("[A](https://a.com/x) · [B](https://b.com/y)").labels).toBe(0);
    expect(run("[공식 문서](https://a.com/x) 에 따르면 된다.").labels).toBe(0);
  });

  it("칩 대상이 아닌 링크(그림 링크 · 열 수 없는 주소)는 이름표가 아니다", () => {
    expect(run("끝입니다. [문서](./a.md)").body).toBe("끝입니다. [문서]");
  });

  it("글자 = 사이트 이름인 이름표는 툴팁 글자 없는 칩", () => {
    expect(run("끝입니다. [github.com](https://github.com/a)").body).toBe("끝입니다.{github.com|}");
  });

  it("실제 기록 — 굵은 글 안의 키워드 링크는 칩 없이 제자리 링크", () => {
    const r = run("**[Context7](https://context7.com/docs/overview)은 AI 코딩 도우미가 최신 라이브러리 문서와 코드 예제를 찾아 참고하도록 해주는 서비스입니다.** 쉽게 말하면 …");
    expect(r.labels).toBe(0);
    expect(r.body).toContain("*[Context7]은 AI");
  });

  it("실제 기록 — 문장 중간 키워드 링크는 칩 없음", () => {
    const r = run("동작 과정은 다음과 같습니다. [문서 검색 도구](https://context7.com/docs)는 크게 두 단계로 구성됩니다.");
    expect(r.body).toBe("동작 과정은 다음과 같습니다. [문서 검색 도구]는 크게 두 단계로 구성됩니다.");
  });

  it("굵은 글의 문장 끝 뒤도 이름표", () => {
    expect(run("**중요합니다.** [출처](https://a.com/x)").body).toBe("중요합니다.{a.com|출처}");
  });

  it("굵은 글 안 괄호 출처도 그 자리 칩 · 강조 안 문장 끝 뒤 링크는 키워드(강조 끝은 줄 끝이 아니다)", () => {
    expect(run("**채널이 핵심이다 ([A](https://a.com/x)).** 이어서").body).toBe("*채널이 핵심이다{a.com|A}.* 이어서");
    expect(run("**핵심이다. [A](https://a.com/x)** 이어서").body).toBe("*핵심이다. [A]* 이어서");
  });

  it("입력은 바꾸지 않는다", () => {
    const xs = parseInline("끝입니다 ([A](https://a.com/x)). **다 ([B](https://b.com/y)).**");
    const copy = JSON.parse(JSON.stringify(xs));
    placeSourceChips(xs, web);
    expect(xs).toEqual(copy);
  });
});
