use super::*;

fn h(src: &str) -> String {
    html(&parse(src))
}

fn d(src: &str) -> String {
    discord(&parse(src))
}

fn p(src: &str) -> String {
    plain(&parse(src))
}

/// Telegram 이 받는 HTML 인지 — 쓰는 태그만 · 짝 · `<code>` · `<pre>` 안에 태그 없음 · 블록 태그는 맨 바깥만 · 엔티티는 셋뿐.
pub(crate) fn balanced(html: &str) -> Result<(), String> {
    const INLINE: &[&str] = &["b", "i", "s", "code"];
    const BLOCK: &[&str] = &["pre", "blockquote"];
    let mut stack: Vec<&str> = Vec::new();
    let mut i = 0;
    let b = html.as_bytes();
    while i < b.len() {
        match b[i] {
            b'&' => {
                let rest = &html[i..];
                let n = ["&amp;", "&lt;", "&gt;"].iter().find(|e| rest.starts_with(**e)).ok_or_else(|| format!("엔티티 {i}: {html}"))?;
                i += n.len();
            }
            b'>' => return Err(format!("걷지 않은 > {i}: {html}")),
            b'<' => {
                let gt = html[i..].find('>').ok_or_else(|| format!("닫히지 않은 태그 {i}: {html}"))? + i;
                let tag = &html[i + 1..gt];
                match tag.strip_prefix('/') {
                    Some(name) => {
                        if stack.pop() != Some(name) {
                            return Err(format!("짝이 틀린 </{name}> {i}: {html}"));
                        }
                    }
                    None => {
                        if !INLINE.contains(&tag) && !BLOCK.contains(&tag) {
                            return Err(format!("모르는 태그 <{tag}>: {html}"));
                        }
                        if stack.last().is_some_and(|t| *t == "code" || *t == "pre") {
                            return Err(format!("<code>/<pre> 안의 태그 <{tag}>: {html}"));
                        }
                        if BLOCK.contains(&tag) && !stack.is_empty() {
                            return Err(format!("안쪽의 블록 태그 <{tag}>: {html}"));
                        }
                        // 굵게 · 기울임 · 취소선은 code · pre 를 품지 못한다(Bot API 엔티티 중첩 규칙)
                        if tag == "code" && stack.iter().any(|t| matches!(*t, "b" | "i" | "s")) {
                            return Err(format!("서식 안의 <code>: {html}"));
                        }
                        if html[gt + 1..].starts_with(&format!("</{tag}>")) {
                            return Err(format!("빈 태그 쌍 <{tag}>: {html}"));
                        }
                        stack.push(tag);
                    }
                }
                i = gt + 1;
            }
            _ => i += 1,
        }
    }
    if stack.is_empty() { Ok(()) } else { Err(format!("열린 태그 {stack:?}: {html}")) }
}

/// 엔티티 해석 뒤 글자(Telegram 의 4096 이 세는 것).
pub(crate) fn visible_html(html: &str) -> String {
    let mut out = String::new();
    let mut in_tag = false;
    for c in html.chars() {
        match c {
            '<' => in_tag = true,
            '>' => in_tag = false,
            c if !in_tag => out.push(c),
            _ => {}
        }
    }
    out.replace("&lt;", "<").replace("&gt;", ">").replace("&amp;", "&")
}

fn units(s: &str) -> usize {
    s.chars().map(char::len_utf16).sum()
}

#[test]
fn korean_particles_after_emphasis() {
    assert_eq!(h("**굵게**는 됩니다"), "<b>굵게</b>는 됩니다");
    assert_eq!(h("**\"인용\"**은"), "<b>\"인용\"</b>은");
    assert_eq!(h("**테스트(test)**를 봤다"), "<b>테스트(test)</b>를 봤다");
    assert_eq!(h("*기울임*과 ~~취소~~도"), "<i>기울임</i>과 <s>취소</s>도");
    assert_eq!(h("__굵게__"), "<b>굵게</b>");
}

#[test]
fn words_with_symbols_stay_text() {
    assert_eq!(h("snake_case_name 과 a_b"), "snake_case_name 과 a_b");
    assert_eq!(h("__init__ 와 __init__.py"), "__init__ 와 __init__.py", "파이썬 이름은 굵게가 아니다");
    assert_eq!(h("a * b * c"), "a * b * c");
    assert_eq!(h("2 ** 10"), "2 ** 10");
    assert_eq!(h("*.rs 와 *.toml"), "*.rs 와 *.toml");
    assert_eq!(h("~한 개~ · ~~~세 개~~~"), "~한 개~ · ~~~세 개~~~");
    // 짝 없는 기호는 글자 그대로
    for s in ["**a", "a**", "`a", "~~a", "*", "**", "_", "a_", "[a](", "[a]", "![x]", "<", "a <b> c", "\\"] {
        assert_eq!(visible_html(&h(s)), s, "{s}");
    }
    assert_eq!(h("\\*a\\* \\_b\\_ \\`c\\`"), "*a* _b_ `c`", "걷기 `\\`");
    assert_eq!(h("a\\b"), "a\\b", "구두점이 아니면 `\\` 는 글자");
}

#[test]
fn code_spans_are_literal() {
    assert_eq!(h("`a*b*c` 와 `<x> & y`"), "<code>a*b*c</code> 와 <code>&lt;x&gt; &amp; y</code>");
    assert_eq!(h("`` a`b ``"), "<code>a`b</code>");
    // Telegram 은 굵게 안의 code 를 받지 않는다 — 코드 앞에서 닫고 뒤에서 다시 연다 · 빈 쌍은 내지 않는다
    assert_eq!(h("**`코드`는**"), "<code>코드</code><b>는</b>");
    assert_eq!(h("**`foo`**"), "<code>foo</code>");
    assert_eq!(h("## `foo` 고침"), "<code>foo</code><b> 고침</b>");
    assert_eq!(h("**a `b` c**"), "<b>a </b><code>b</code><b> c</b>");
    assert_eq!(h("***a* `b`** c"), "<b><i>a</i> </b><code>b</code> c");
    assert_eq!(h("> 인용 `x`"), "<blockquote>인용 <code>x</code></blockquote>", "인용 안의 code 는 그대로");
    assert_eq!(h("``"), "``");
    assert_eq!(h("` `"), "<code> </code>");
}

#[test]
fn fences_tables_lists_headings_quotes() {
    assert_eq!(h("```rust\nlet *p = __init__;\n```"), "<pre>let *p = __init__;</pre>");
    assert_eq!(h("~~~\na\n~~~\nb"), "<pre>a</pre>\nb");
    assert_eq!(h("앞\n```\n열린 채\n**끝**"), "앞\n<pre>열린 채\n**끝**</pre>", "닫히지 않으면 끝까지 코드");
    assert_eq!(h("- 목록\n  ```\n  x\n  ```"), "• 목록\n<pre>x</pre>", "들여 쓴 울타리");
    assert_eq!(h("```\n\n```"), "", "빈 코드 블록은 없앤다");
    assert_eq!(h("| a | **b** |\n|---|:-:|\n| 1 | 2 |"), "<pre>| a | **b** |\n|---|:-:|\n| 1 | 2 |</pre>");
    assert_eq!(h("| 표가 | 아님 |"), "| 표가 | 아님 |");
    assert_eq!(h("- a\n  * b\n+ **c**\n1. d"), "• a\n  • b\n• <b>c</b>\n1. d");
    assert_eq!(h("## 제목 **굵게** *기울임*"), "<b>제목 굵게 <i>기울임</i></b>");
    assert_eq!(h("# C# ##"), "<b>C#</b>");
    assert_eq!(h("#123 고침\n#"), "#123 고침");
    assert_eq!(h("> 인용 **a**\n> 둘\n밖"), "<blockquote>인용 <b>a</b>\n둘</blockquote>\n밖");
    assert_eq!(h("> - 목록 인용"), "<blockquote>• 목록 인용</blockquote>");
    assert_eq!(h("a\n\n\n---\n\n* * *\nb"), "a\n\nb", "가로줄 · 빈 줄 여럿은 빈 줄 하나");
    assert_eq!(h("\n\n  \na\n\n"), "a");
}

#[test]
fn links_are_text() {
    assert_eq!(p("[문서](https://x.y/a_b) 를 보세요"), "문서 (https://x.y/a_b) 를 보세요");
    assert_eq!(p("[https://x.y](https://x.y)"), "https://x.y", "주소가 글자와 같으면 한 번");
    assert_eq!(p("[글](<https://a b> \"제목\")"), "글 (https://a b)");
    assert_eq!(p("[글]()"), "글");
    assert_eq!(p("![그림 설명](a.png) 끝"), "그림 설명 끝");
    assert_eq!(p("<https://a.b/c> · <mailto:a@b.c> · <tag>"), "https://a.b/c · mailto:a@b.c · <tag>");
    assert_eq!(h("[**굵은** 링크](u)"), "<b>굵은</b> 링크 (u)");
    assert_eq!(h("[a](u(1))"), "a (u(1))", "괄호 짝");
    // 링크 안의 링크는 깊이 상한까지만 — 그 안은 글자
    let deep = "[".repeat(8) + "x" + &"](u)".repeat(8);
    assert!(!p(&deep).is_empty());
}

#[test]
fn discord_markdown() {
    assert_eq!(d("**a** <@1> [x](y) _u_ # h"), r"**a** \<@1\> x \(y\) *u* \# h");
    assert_eq!(d("**a***b*"), "**a**\u{200b}*b*", "맞붙은 기호 사이에 폭 없는 공백");
    assert_eq!(d("**a****b**"), "**ab**", "맞붙은 같은 짝은 하나로");
    assert_eq!(d("`a` `b`"), "`a` `b`");
    assert_eq!(d("`` a`b ``"), "``a`b``");
    assert_eq!(d("`` `x` ``"), "`` `x` ``");
    assert_eq!(d("# 제목\n- 목록\n> 인용"), "**제목**\n• 목록\n> 인용");
    assert_eq!(d("````\n```\n````"), "```\n`\u{200b}`\u{200b}`\n```", "블록 안의 ``` 가 블록을 닫지 않는다");
    assert_eq!(d("```rust\nx\n```\n```c<x>\ny\n```"), "```rust\nx\n```\n```\ny\n```", "언어 이름이 이상하면 뺀다");
    assert_eq!(d("```python title=\"a\"\nx\n```"), "```python\nx\n```", "언어 이름은 첫 낱말만");
    assert_eq!(d("**굵게 *기울임* `코드`**는"), "**굵게 *기울임* `코드`**는");
    assert_eq!(d("**a **b** c**"), "**a b c**", "같은 표시 안의 같은 표시는 걷는다");
}

#[test]
fn plain_drops_marks() {
    assert_eq!(p("## 제목\n**a** *b* ~~c~~ `d`\n> 인용\n```\ncode\n```"), "제목\na b c d\n인용\ncode");
}

#[test]
fn line_helpers() {
    let l = Line { quote: false, items: inline("**가나다라**마") };
    assert_eq!(l.visible(), 5);
    assert_eq!(inline_html(&l.truncate(3).items), "<b>가나</b>…");
    assert_eq!(inline_html(&l.truncate(5).items), "<b>가나다라</b>마");
    let c = Line::code("a*b");
    assert_eq!(inline_html(&c.truncate(2).items), "<code>a</code>…");
    let mut m = Line { quote: false, items: inline("*x*") };
    m.mark_cut();
    m.mark_cut();
    assert_eq!(inline_html(&m.items), "<i>x</i>…");
    let s = Line { quote: false, items: inline("  a   **b  c**  ") }.squash();
    assert_eq!(inline_html(&s.items), "a <b>b c</b>");
}

#[test]
fn unclosed_fence_reopens() {
    let f = unclosed_fence("a\n  ```rust  extra\nx").expect("열림");
    assert_eq!((f.opener(), f.closer()), ("  ```rust".to_string(), "  ```".to_string()));
    assert!(unclosed_fence("```\nx\n```").is_none());
    assert!(unclosed_fence("````\n```\n").is_some(), "짧은 울타리는 닫지 못한다");
    assert_eq!(unclosed_fence("~~~~\n").map(|f| f.closer()), Some("~~~~".to_string()));
    assert!(unclosed_fence("`` x").is_none());
}

/// 고약한 입력 — 패닉 · 무한 루프 없이 · Telegram HTML 은 늘 짝이 맞고 · 해석 뒤 글자가 원문보다 늘지 않는다(4096 상한의 근거).
#[test]
fn hostile_inputs_stay_balanced() {
    let fixed = [
        "", "*", "**", "***", "** **", "*a **b* c**", "`", "``", "` `", "`a``b`", "``a`", "<b>&amp;</b>", "&<>", "~~a", "~a~",
        "__init__", "_*_*", "*_*_", "**_a_**", "*`a`*", "**`**`**", "가**나**다", "😀**😀**😀", "[a](", "[](u)", "[[a](b)](c)",
        "![x](y", "<https://", "\\", "#", "# ", "######## x", ">", ">>>>", "- ", "- **a", "```", "```\n", "~~~rust\nx", "|a|\n|-|",
        "| x", "---", "> ```\n> x", "**a\n**b", "[`a]`](u)", "\u{200b}**\u{200b}**", "a\r\n**b**\r\n",
    ];
    let alphabet: Vec<char> = "*_~`[]()<>&!\\#|-: \n\taZ가😀./".chars().collect();
    let mut seed: u64 = 0x2545_F491_4F6C_DD1D;
    let mut next = || {
        seed ^= seed << 13;
        seed ^= seed >> 7;
        seed ^= seed << 17;
        seed
    };
    let mut cases: Vec<String> = fixed.iter().map(|s| s.to_string()).collect();
    for _ in 0..3000 {
        let n = (next() % 60) as usize;
        cases.push((0..n).map(|_| alphabet[(next() % alphabet.len() as u64) as usize]).collect());
    }
    cases.push("[".repeat(3000) + &"]".repeat(3000));
    cases.push("`".repeat(2001) + "a" + &" `".repeat(2000));
    cases.push("*a ".repeat(2000));
    for src in &cases {
        let doc = parse(src);
        let html = html(&doc);
        if let Err(e) = balanced(&html) {
            panic!("{e}\n원문: {src:?}");
        }
        assert!(units(&visible_html(&html)) <= units(src), "해석 뒤 글자가 늘었다: {src:?} → {html:?}");
        let _ = discord(&doc);
        assert!(units(&plain(&doc)) <= units(src), "{src:?}");
    }
}
