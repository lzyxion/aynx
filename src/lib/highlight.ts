/**
 * 구문 강조 — 결과는 HTML 이 아니라 hast 트리다(`{@html}` 없음 — 원격 파일의 `<script>` 는 글자다).
 * `lowlight/lib/common` · `all` 은 쓰지 않는다 — 번들이 커진다. 언어를 늘리면 `doc-lang.ts` 의 표도 함께.
 * 이 모듈을 정적으로 import 하지 않는다 — `highlight-loader.ts` 로만 부른다.
 */
import { createLowlight } from "lowlight";
import type { Root } from "hast";
import { tooLargeToHighlight } from "$lib/highlight-size";
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import dos from "highlight.js/lib/languages/dos";
import go from "highlight.js/lib/languages/go";
import ini from "highlight.js/lib/languages/ini";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import makefile from "highlight.js/lib/languages/makefile";
import markdown from "highlight.js/lib/languages/markdown";
import nginx from "highlight.js/lib/languages/nginx";
import powershell from "highlight.js/lib/languages/powershell";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

const lowlight = createLowlight({
  bash,
  c,
  cpp,
  css,
  diff,
  dockerfile,
  dos,
  go,
  ini,
  java,
  javascript,
  json,
  makefile,
  markdown,
  nginx,
  powershell,
  python,
  rust,
  sql,
  typescript,
  xml,
  yaml,
});
// hljs 의 `shell`/`console` 은 따로 된 "셸 세션" 문법이라 등록하지 않았다 — bash 로 읽는다
lowlight.registerAlias({ bash: ["shell", "console"], json: ["jsonc", "json5"] });

export { HIGHLIGHT_MAX_CHARS, HIGHLIGHT_MAX_LINES, tooLargeToHighlight } from "$lib/highlight-size";

export function isHighlightable(lang: string | null | undefined): lang is string {
  return !!lang && lowlight.registered(lang);
}

/** 언어를 모르거나 너무 크면 `null`(평문으로 그린다) */
export function highlight(code: string, lang: string | null | undefined): Root | null {
  if (!isHighlightable(lang) || tooLargeToHighlight(code)) return null;
  try {
    return lowlight.highlight(lang, code);
  } catch {
    // 문법이 스스로 던지는 일은 드물지만, 강조가 실패해도 글은 보여야 한다
    return null;
  }
}
