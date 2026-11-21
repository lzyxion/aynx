/**
 * 프로젝트 설정 스크립트의 끝 신호 `ESC ] 7717 ; aynx-setup ; <nonce> ; <종료 코드> BEL` 을 읽는 순수 모듈.
 * 신호를 찍는 한 줄은 Rust(`setup_script.rs`)가 짓는다 — 모양을 바꾸면 양쪽을 함께 바꾼다.
 */

/** Rust `setup_script::SETUP_OSC` 와 같은 수 */
export const SETUP_OSC = 7717;

const SETUP_TAG = "aynx-setup";

export interface SetupSignal {
  nonce: string;
  code: number;
}

/** 다른 프로그램이 같은 번호를 써도 첫 칸이 다르면 무시한다 */
export function parseSetupOsc(data: string): SetupSignal | null {
  const parts = data.split(";");
  if (parts.length !== 3 || parts[0] !== SETUP_TAG) return null;
  const [, nonce, raw] = parts;
  if (!/^[0-9a-f]{8,64}$/i.test(nonce)) return null;
  if (!/^-?\d{1,10}$/.test(raw.trim())) return null;
  return { nonce: nonce.toLowerCase(), code: Number.parseInt(raw.trim(), 10) };
}

/** 비밀이 아니라 "이 실행의 신호인가" 를 가르는 표지다(다른 출력이 흉내 내기 어렵게) */
export function newSetupNonce(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
