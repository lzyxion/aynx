/**
 * 문서 타일의 [새 문서…] — 이름 규칙(순수 층). 폴더는 지금 문서의 폴더로 고정이라 경로를 섞는 이름은 거절한다 — 원격 POSIX 도 `\` 를
 * 막는다(이름이 조용히 다른 자리를 가리키지 않게). 텍스트로 열 수 없는 이름은 만들어도 문서 타일이 열지 못해 거절한다.
 */

import { nameError } from "$lib/fs-backend";
import { isTextLike } from "$lib/doc-lang";
import type { Key } from "$lib/i18n/keys";

export const NEW_DOC_DEFAULT = "untitled.md";

export type NewDocName = { ok: true; name: string } | { ok: false; error: Key; params?: Record<string, string> };

/** 점으로 시작하는 이름(`.gitignore`)은 그 이름이 곧 종류라 `.md` 를 붙이지 않는다 */
function keepsName(name: string): boolean {
  return name.startsWith(".") || name.lastIndexOf(".") > 0;
}

export function newDocName(input: string, sep: string): NewDocName {
  const raw = input.trim();
  if (raw === "") return { ok: false, error: "files.browser.newfile.empty" };
  if (/[\\/]/.test(raw) || raw.includes("..")) return { ok: false, error: "files.doc.new.path" };
  const bad = nameError(raw, sep);
  if (bad) return { ok: false, error: bad };
  const name = keepsName(raw) ? raw : `${raw}.md`;
  if (!isTextLike(name)) return { ok: false, error: "files.doc.new.notText", params: { name } };
  return { ok: true, name };
}

export function stemEnd(name: string): number {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? dot : name.length;
}
