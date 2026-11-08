/**
 * **프로젝트 설정 스크립트**의 터미널 쪽 규칙 — 순수 모듈 (docs/log/2026-09-28-project-agent-setup-script.md).
 *
 * 스크립트를 한 줄로 짓는 일은 Rust(`setup_script.rs`)가 하고, 그 한 줄은 끝에서 **끝 신호**
 * `ESC ] 7717 ; aynx-setup ; <nonce> ; <종료 코드> BEL` 을 찍는다. 터미널(`Terminal.svelte`)은 자기가 기다리는
 * nonce 일 때만 그 신호를 받는다 — 여기는 그 신호를 읽는 규칙과 nonce 를 뽑는 일만 둔다(vitest 가 닿게).
 */

/** 끝 신호의 OSC 번호 — Rust `setup_script::SETUP_OSC` 와 같은 수 */
export const SETUP_OSC = 7717;

/** 끝 신호의 첫 칸 */
const SETUP_TAG = "aynx-setup";

/** 끝 신호 하나 — 어느 실행(nonce)의 몇 번 종료 코드인가 */
export interface SetupSignal {
  nonce: string;
  code: number;
}

/**
 * OSC 7717 의 본문(`aynx-setup;<nonce>;<code>`) → 신호. 모양이 어긋나면 `null` — 다른 프로그램이 같은 번호를 써도
 * 첫 칸이 다르면 무시한다. nonce 는 16진 8~64자, 코드는 부호 있는 정수만.
 */
export function parseSetupOsc(data: string): SetupSignal | null {
  const parts = data.split(";");
  if (parts.length !== 3 || parts[0] !== SETUP_TAG) return null;
  const [, nonce, raw] = parts;
  if (!/^[0-9a-f]{8,64}$/i.test(nonce)) return null;
  if (!/^-?\d{1,10}$/.test(raw.trim())) return null;
  return { nonce: nonce.toLowerCase(), code: Number.parseInt(raw.trim(), 10) };
}

/** 새 nonce — 16진 32자. 비밀이 아니라 "이 실행의 신호인가" 를 가르는 표지다(다른 출력이 흉내 내기 어렵게) */
export function newSetupNonce(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
