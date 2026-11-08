/**
 * **대화 면 출처 칩의 순수 판정**(`MarkdownBlocks` 의 `linkStyle="chip"` — 2026-11-01 사용자 결정).
 *
 * - 키워드(링크 글자)는 문장 제자리에서 링크로 그린다 — 칩을 만들지 않는다(그 링크가 곧 여는 자리 — 2026-11-01 (나)안).
 * - **출처 이름표**(문장 끝 뒤에 혼자 붙은 링크 — `…입니다. [공식 저장소](url)` · 괄호 묶음 `([공식 문서](url))`)는
 *   **모델이 단 그 자리에서 출처 칩**(사이트 이름 ↗)이 된다(2026-11-01 — 출처 칩은 모델이 단 자리 그대로 · 블록 끝 모음은 걷었다).
 *   괄호 묶음은 괄호를 지우고 칩만 남긴다. 판정 규칙은 `placeSourceChips` 머리말.
 * - 글자가 곧 주소 · 사이트 이름인 링크(`chipOnly`)는 그 자리의 칩이 링크다.
 * 어떤 링크가 칩 대상인지(`onlink` · 그림 링크 등 컴포넌트 사정)는 부르는 쪽이 `isChip` 으로 준다.
 */
import { linkHost, type MdInline } from "$lib/markdown";

type LinkInline = Extract<MdInline, { kind: "link" }>;

/** 링크 글자가 곧 주소 · 사이트 이름인가 — 그러면 글자를 두 번 적지 않고 그 자리에 칩 하나만 둔다 */
export function chipOnly(s: { text: string; href: string }): boolean {
  const x = s.text.trim().toLowerCase();
  const host = linkHost(s.href);
  return x === "" || x === s.href.toLowerCase() || x === host || x === `www.${host}`;
}

/** 문장 끝 부호 — `:` 는 넣지 않는다(`- 라벨: [A](u) · [B](u)` 는 키워드 나열이다) */
const SENTENCE_END = /[.?!。…]$/;
/** 이름표 사이 · 뒤의 구분자 글(공백 포함) — 이것뿐인 글은 이름표 묶음의 일부다 */
const SEP_ONLY = /^\s*[,·、|/]?\s*$/;
const isText = (s: MdInline | undefined): s is { kind: "text"; text: string } => s?.kind === "text";

/** 이름표 묶음의 링크들 → 그 자리 칩 토큰(`source: true`) — 같은 주소(`href` 정확 일치) 연달음은 칩 하나 · 툴팁 글자는 겹치지 않게 모은다 */
function chipsOf(links: LinkInline[]): MdInline[] {
  const out: { href: string; texts: string[] }[] = [];
  for (const s of links) {
    const text = chipOnly(s) ? "" : s.text.trim();
    const last = out[out.length - 1];
    if (last && last.href === s.href) {
      if (text && !last.texts.includes(text)) last.texts.push(text);
      continue;
    }
    out.push({ href: s.href, texts: text ? [text] : [] });
  }
  return out.map((c) => ({ kind: "link", text: c.texts.join(" · "), href: c.href, source: true }));
}

/**
 * **출처 이름표 → 그 자리 칩** — 이름표 링크를 칩 토큰(`kind:"link"` + `source: true`)으로 바꾼 인라인을 돌려준다(입력은 바꾸지 않는다).
 *
 * 이름표 = 칩 대상 링크(`isChip`)의 **묶음**(구분자 `,` `·` `、` `|` `/` 나 공백만 사이에 둔 연달은 링크)이고 둘 중 하나:
 * 1. **괄호 묶음** — 바로 앞 글이 `(` 로 끝나고 바로 뒤 글이 `)` 로 시작한다(`([공식 문서](u))` · `([A](u), [B](u))`). 뒤에 글이
 *    이어져도(줄 중간이어도) 이름표다. 괄호 · 괄호 앞 공백 · 구분자를 지운다 — `channels ([Tauri docs](u)).` → `channels` + 칩 + `.`.
 * 2. **문장 끝 뒤** — 바로 앞 인라인의 글이 문장 끝 부호(`.` `?` `!` `。` `…`)로 끝나거나 블록 맨 앞(앞에 글 없음)이고,
 *    묶음 뒤가 블록 끝 · 줄바꿈(소프트 줄바꿈 `\n`)이다. 공백 뒤에 같은 줄의 글이 이어지면 이름표로 보지 않는다 —
 *    `…다. [React](u) 기반 앱은` 처럼 키워드로 시작하는 새 문장과 갈라 낼 길이 없어서다(본문의 낱말을 잃는 쪽이 더 나쁘다).
 *    문장 끝 부호와 칩 사이 공백은 걷는다(칩의 왼쪽 여백이 띄운다) · 줄바꿈은 남긴다.
 * 칩은 그 자리에 하나씩 선다 — 묶음 안 같은 주소 연달음은 하나(`chipsOf`).
 * 블록에 링크 · 구분자 말고 글이 없으면(링크 하나뿐인 문단 · 링크 나열) 아무것도 바꾸지 않는다 — 키워드 링크 그대로.
 * 칩 대상이 아닌 링크(배지 · 그림 링크 · 열 수 없는 주소)는 이름표가 되지 않는다.
 * 굵게 · 기울임 · 취소선의 안쪽(`inlines`)에는 **괄호 묶음만** 같은 규칙을 건다(`**…다 ([A](u)).**` — 강조 끝은 줄 끝이 아니라
 * 문장 끝 규칙을 걸 수 없다). 바깥의 문장 끝 판정은 강조의 평문 `text` 로 한다(`**…다.** [출처](u)`).
 */
export function placeSourceChips(xs: readonly MdInline[], isChip: (s: LinkInline) => boolean, parenOnly = false): MdInline[] {
  const cand = (s: MdInline | undefined): s is LinkInline => s?.kind === "link" && !s.source && isChip(s);
  const prose = xs.some((s) => s.kind !== "link" && !SEP_ONLY.test(s.text) && s.text.replace(/[\s()[\]:;,·、|/.?!。…-]/g, "") !== "");
  if (!prose) return [...xs];

  /** 지울 자리(null) · 고칠 글(글 토막만) — 끝에 한 번에 걷는다 */
  const edit = new Map<number, string | null>();
  /** 묶음 첫 자리 → 그 자리에 설 칩들 */
  const chips = new Map<number, MdInline[]>();
  const textAt = (i: number) => {
    const e = edit.get(i);
    if (e === null) return null;
    const s = xs[i];
    return e ?? (s && s.kind !== "link" && s.kind !== "image" && s.kind !== "fnref" ? s.text : s ? "" : null);
  };

  let i = 0;
  while (i < xs.length) {
    if (!cand(xs[i])) {
      i++;
      continue;
    }
    // 묶음 [i, j] — 링크 · 구분자 글이 번갈아 선다
    let j = i;
    for (let sep = xs[j + 1]; isText(sep) && SEP_ONLY.test(sep.text) && !sep.text.includes("\n") && cand(xs[j + 2]); sep = xs[j + 1]) j += 2;
    const prev = xs[i - 1];
    const next = xs[j + 1];
    const prevText = prev ? textAt(i - 1) : "";
    const nextText = isText(next) ? next.text : null;

    let kind: "paren" | "sentence" | null = null;
    if (isText(prev) && prevText !== null && /\(\s*$/.test(prevText) && nextText !== null && /^\s*\)/.test(nextText)) kind = "paren";
    else if (!parenOnly) {
      // 공백뿐인 글(`**…다.** [출처](u)` 의 사이 공백)은 건너 그 앞 인라인을 본다
      let p = i - 1;
      while (p >= 0 && isText(xs[p]) && (textAt(p) ?? "").trim() === "") p--;
      const pt = p >= 0 ? textAt(p) : "";
      const before = p < 0 || (xs[p].kind !== "link" && xs[p].kind !== "image" && pt !== null && SENTENCE_END.test(pt.trimEnd()));
      const after = next === undefined || (nextText !== null && (/^[ \t]*\n/.test(nextText) || (SEP_ONLY.test(nextText) && j + 2 >= xs.length)));
      if (before && after) {
        kind = "sentence";
        for (let k = p + 1; k < i; k++) edit.set(k, null);
        if (p >= 0 && isText(xs[p]) && pt !== null) edit.set(p, pt.trimEnd());
        // 칩 뒤 꼬리 공백 · 구분자는 걷고 줄바꿈은 남긴다
        if (nextText !== null) edit.set(j + 1, /^[ \t]*\n/.test(nextText) ? nextText.replace(/^[ \t]*/, "") : null);
      }
    }
    if (!kind) {
      i = j + 1;
      continue;
    }
    const links: LinkInline[] = [];
    for (let k = i; k <= j; k++) {
      const s = xs[k];
      if (k % 2 === i % 2 && s.kind === "link") links.push(s);
      edit.set(k, null);
    }
    chips.set(i, chipsOf(links));
    if (kind === "paren") {
      edit.set(i - 1, (prevText ?? "").replace(/\s*\(\s*$/, ""));
      edit.set(j + 1, (nextText ?? "").replace(/^\s*\)/, ""));
    }
    i = j + 2;
  }

  const out: MdInline[] = [];
  xs.forEach((s, k) => {
    const c = chips.get(k);
    if (c) {
      out.push(...c);
      return;
    }
    const e = edit.get(k);
    if (e === undefined) {
      if ((s.kind === "strong" || s.kind === "em" || s.kind === "del") && s.inlines) out.push({ ...s, inlines: placeSourceChips(s.inlines, isChip, true) });
      else out.push(s);
    } else if (e) out.push({ kind: "text", text: e });
  });
  return out;
}
