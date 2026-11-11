/**
 * **문서 타일의 [새 문서…] — 이름 규칙(순수 층)** (2026-11-11). 상자 · 만들기 · 열기는 `app/new-doc.svelte.ts`, 그림은 `doc/NewDocBox.svelte`.
 *
 * 이름 한 조각만 받는다 — 폴더는 지금 문서의 폴더로 고정이라(폴더 고르기 없음) 경로를 섞는 이름은 거절한다:
 *
 * 1. 앞뒤 공백을 뗀다 · 비면 거절
 * 2. 경로 구분자(`/` `\`) · `..` 가 들면 거절 — 백엔드가 어느 쪽이든(원격 POSIX 도 `\` 를 막는다: 이름이 조용히 다른 자리를 가리키지 않게)
 * 3. 그 백엔드의 금지 글자 — 파일 타일의 새 파일 · 이름 바꾸기와 **같은 검사**(`fs-backend` 의 `nameError` — 로컬 윈도우는 `: * ? " < > |` 도)
 * 4. 확장자가 없으면 `.md` 를 붙인다(`README` → `README.md` · `Makefile` → `Makefile.md`) — 점으로 시작하는 이름(`.gitignore` · `.env`)은 그 이름이
 *    곧 종류라 그대로 둔다
 * 5. 텍스트로 열 수 없는 이름(`isTextLike` 가 아닌 것 — `.png` · `.zip` …)은 거절 — 만들어도 문서 타일이 열지 못한다
 */

import { nameError } from "$lib/fs-backend";
import { isTextLike } from "$lib/doc-lang";
import type { Key } from "$lib/i18n/keys";

/** 상자의 기본 이름 — 확장자 앞(`untitled`)이 골라진 채 뜬다([`stemEnd`]) */
export const NEW_DOC_DEFAULT = "untitled.md";

export type NewDocName = { ok: true; name: string } | { ok: false; error: Key; params?: Record<string, string> };

/** `.md` 를 붙이지 않는가 — 확장자가 있다(첫 글자가 아닌 자리의 `.`) 또는 점으로 시작하는 이름이다 */
function keepsName(name: string): boolean {
  return name.startsWith(".") || name.lastIndexOf(".") > 0;
}

/** 친 이름 → 만들 파일 이름(한 조각) 또는 거절 까닭. `sep` 은 그 백엔드의 구분자(`FsBackend.sep`) */
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

/** 이름 칸에서 처음 고를 끝 — 확장자 앞까지(없으면 전부) */
export function stemEnd(name: string): number {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? dot : name.length;
}
