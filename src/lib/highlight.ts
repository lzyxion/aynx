/**
 * **구문 강조** — lowlight(core) 에 **계약 §2 의 언어만** 등록한다. 결과는 HTML 이 아니라 **hast 트리**이고,
 * `CodeView.svelte` 가 그것을 Svelte 로 재귀해 그린다(`{@html}` 없음 — 원격 파일의 `<script>` 는 글자다).
 *
 * `lowlight/lib/common` 이나 `all` 을 쓰지 않는 이유: 그 둘은 수십 개 언어를 한꺼번에 끌고 와 번들이 커진다.
 * 언어를 늘릴 때는 여기 한 줄 + `doc-lang.ts` 의 표 한 줄(그리고 `highlight.test.ts` 가 둘이 맞는지 본다).
 *
 * **이 모듈을 정적으로 import 하지 않는다** — 화면은 `highlight-loader.ts` 로만 부른다(메인 청크에서 빼 둔 것,
 * 문서 보기 B6). 크기 판정만 필요하면 `highlight-size.ts`.
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
// README 의 펜스에 흔한 이름 — hljs 에서 `shell`/`console` 은 따로 된 "셸 세션" 문법이라 등록하지 않았다. bash 로 읽는다
lowlight.registerAlias({ bash: ["shell", "console"], json: ["jsonc", "json5"] });

// 크기 판정은 따로 된 가벼운 모듈에 있다 — 이 모듈은 동적 import 로만 불리고(`highlight-loader.ts`), 화면이
// 띠를 걸 판정을 곧바로 보려고 여기를 정적으로 부르면 강조기 전체가 메인 청크로 돌아온다
export { HIGHLIGHT_MAX_CHARS, HIGHLIGHT_MAX_LINES, tooLargeToHighlight } from "$lib/highlight-size";

/** 등록된 이름이나 별칭(`ts` · `sh` · `yml` · `ps1` · `toml` · `html` …)인가 */
export function isHighlightable(lang: string | null | undefined): lang is string {
  return !!lang && lowlight.registered(lang);
}

/** 강조한 트리 — 언어를 모르거나 너무 크면 `null`(평문으로 그린다) */
export function highlight(code: string, lang: string | null | undefined): Root | null {
  if (!isHighlightable(lang) || tooLargeToHighlight(code)) return null;
  try {
    return lowlight.highlight(lang, code);
  } catch {
    // 문법이 스스로 던지는 일은 드물지만, 강조가 실패해도 글은 보여야 한다
    return null;
  }
}
