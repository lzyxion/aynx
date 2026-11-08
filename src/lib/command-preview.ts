/**
 * **긴 명령문을 화면에 얼마만큼 보일 것인가** — 순수 계산 하나
 * (docs/log/2026-09-20-console-fixes.md ①).
 *
 * 관제판의 작업안 카드·실행 뷰는 `op.command` 를 **통째로** 찍고 있었다. AI 가 만든 작업안은
 * base64 로 감싼 스크립트 한 덩어리일 수 있어서(실측 13 KB) 그 한 줄이 패널을 전부 먹고,
 * `title` 툴팁도 같은 13 KB 라 마우스만 올려도 화면이 덮였다.
 *
 * 그래서 **줄 수와 글자 수 두 상한**으로 자른다 — 둘 중 먼저 걸리는 쪽이 이긴다. 줄만 세면
 * 개행 없는 13 KB 한 줄을 못 막고, 글자만 세면 짧은 30줄짜리가 카드를 밀어낸다.
 *
 * 돌려주는 `chars`·`lines` 는 **잘린 것이 아니라 원본 전체**의 크기다 — 화면이 "전체 보기
 * (13,312자 · 1줄)" 처럼 **무엇을 펴는지**를 먼저 말할 수 있어야 하기 때문이다.
 */

/** 기본 상한 — 카드 하나가 패널에서 차지해도 좋은 크기(세 줄 · 240자) */
export const CMD_PREVIEW_MAX_LINES = 3;
export const CMD_PREVIEW_MAX_CHARS = 240;

/** 잘렸음을 알리는 꼬리 — 한 글자(말줄임표)다 */
const ELLIPSIS = "…";

export interface CommandPreviewOptions {
  /** 남길 줄 수 (기본 3). 1 보다 작으면 1 로 본다. */
  maxLines?: number;
  /** 남길 글자 수 (기본 240). 1 보다 작으면 1 로 본다. */
  maxChars?: number;
}

export interface CommandPreview {
  /** 화면에 찍을 글자 — 잘렸으면 끝에 `…` 가 붙어 있다 */
  text: string;
  /** 원본이 상한을 넘어 잘렸는가 (줄·글자 중 하나라도) */
  truncated: boolean;
  /** **원본 전체**의 줄 수 (빈 명령은 0) */
  lines: number;
  /** **원본 전체**의 글자 수 (앞뒤 공백을 턴 뒤) */
  chars: number;
}

/**
 * 명령문의 **발췌**를 만든다 — 앞뒤 공백을 털고, 앞의 `maxLines` 줄까지만, 그중에서도
 * `maxChars` 글자까지만 남긴다. 잘렸으면 `…` 를 붙이고 `truncated` 를 켠다.
 *
 * 순수 함수다 — 화면도 상태도 만지지 않는다(테스트: `command-preview.test.ts`).
 */
export function commandPreview(
  command: string,
  options: CommandPreviewOptions = {},
): CommandPreview {
  const maxLines = Math.max(1, Math.floor(options.maxLines ?? CMD_PREVIEW_MAX_LINES));
  const maxChars = Math.max(1, Math.floor(options.maxChars ?? CMD_PREVIEW_MAX_CHARS));

  const full = command.trim();
  if (full === "") return { text: "", truncated: false, lines: 0, chars: 0 };

  const allLines = full.split("\n");
  let truncated = allLines.length > maxLines;
  let text = allLines.slice(0, maxLines).join("\n");
  if (text.length > maxChars) {
    truncated = true;
    text = text.slice(0, maxChars);
  }
  // 자른 자리의 꼬리 공백까지 털고 `…` 를 붙인다 — "cmd   …" 로 보이지 않게.
  if (truncated) text = text.replace(/\s+$/, "") + ELLIPSIS;

  return { text, truncated, lines: allLines.length, chars: full.length };
}
