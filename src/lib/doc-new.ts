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

/** 내보내기 이름의 글자 상한(확장자 앞) — 긴 제목이 경로 한도를 먹지 않게 */
const EXPORT_STEM_MAX = 80;

/**
 * **에이전트 답 [문서로 내보내기]의 처음 이름** (2026-11-14 — `app/new-doc.svelte.ts` 의 `openExportDoc`). 답의 첫 마크다운 제목(`#` ~ `######`,
 * 코드 울타리 안은 보지 않는다)에서 인라인 꾸밈(`**` · `_` · `` ` `` · 링크 `[글](주소)` → 글)을 걷고, 어느 백엔드에서도 파일 이름에 못 쓰는 글자
 * (`\ / : * ? " < > |` · 제어 문자)는 빈칸으로, 끝의 점 · 빈칸은 떼고(윈도우), 길면 자르고 `.md` 를 붙인다. 제목이 없거나 남는 글이 없으면
 * [`NEW_DOC_DEFAULT`] — 사람이 상자에서 고친 이름은 [`newDocName`] 이 다시 검사한다.
 */
export function exportDocName(text: string): string {
  let fence: string | null = null;
  for (const line of text.split(/\r?\n/)) {
    const f = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (f) {
      if (fence === null) fence = f[1][0];
      else if (f[1][0] === fence) fence = null;
      continue;
    }
    if (fence !== null) continue;
    const h = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
    if (!h) continue;
    const stem = h[1]
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/[*_`~]/g, "")
      // eslint-disable-next-line no-control-regex
      .replace(/[\/:*?"<>|\u0000-\u001f]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, EXPORT_STEM_MAX)
      .replace(/[.\s]+$/, "")
      .replace(/^\.+/, "");
    return stem === "" ? NEW_DOC_DEFAULT : `${stem}.md`;
  }
  return NEW_DOC_DEFAULT;
}
