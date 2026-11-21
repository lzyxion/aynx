/** 대화 면 출처 칩의 순수 판정 — 어떤 링크가 칩 대상인지는 부르는 쪽이 `isChip` 으로 준다 */
import { linkHost, type MdInline } from "$lib/markdown";

type LinkInline = Extract<MdInline, { kind: "link" }>;

export function chipOnly(s: { text: string; href: string }): boolean {
  const x = s.text.trim().toLowerCase();
  const host = linkHost(s.href);
  return x === "" || x === s.href.toLowerCase() || x === host || x === `www.${host}`;
}

/** `:` 는 넣지 않는다 — `- 라벨: [A](u) · [B](u)` 는 키워드 나열이다 */
const SENTENCE_END = /[.?!。…]$/;
const SEP_ONLY = /^\s*[,·、|/]?\s*$/;
const isText = (s: MdInline | undefined): s is { kind: "text"; text: string } => s?.kind === "text";

/** 같은 주소 연달음은 칩 하나 */
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
 * 출처 이름표(괄호 묶음 `([A](u))` · 문장 끝 뒤 홀로 선 링크 묶음)를 그 자리 칩 토큰으로 바꾼다(입력은 바꾸지 않는다).
 * 문장 끝 뒤 묶음은 뒤가 블록 끝 · 줄바꿈일 때만 — 같은 줄에 글이 이어지면 `…다. [React](u) 기반 앱은` 같은 새 문장과 갈라 낼 길이 없다.
 * 강조 안쪽에는 괄호 묶음만 건다 — 강조 끝은 줄 끝이 아니라 문장 끝 규칙을 걸 수 없다.
 */
export function placeSourceChips(xs: readonly MdInline[], isChip: (s: LinkInline) => boolean, parenOnly = false): MdInline[] {
  const cand = (s: MdInline | undefined): s is LinkInline => s?.kind === "link" && !s.source && isChip(s);
  const prose = xs.some((s) => s.kind !== "link" && !SEP_ONLY.test(s.text) && s.text.replace(/[\s()[\]:;,·、|/.?!。…-]/g, "") !== "");
  if (!prose) return [...xs];

  /** null = 지울 자리 */
  const edit = new Map<number, string | null>();
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
    // 묶음 [i, j] — 링크 · 구분자 글이 번갈아 선다(아래 `k % 2` 가 기댄다)
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
