/**
 * OSC 52 — 원격이 이 PC 의 클립보드에 쓴다 · 순수 파서 (docs/log/2026-09-23-osc52-osc8.md).
 * 읽기 요청(`?`)에는 절대 답하지 않는다 — 답하면 원격 프로그램이 이 PC 의 클립보드(비밀번호 · 토큰)를 읽어 간다.
 * 상한을 넘으면 자르지 않고 버린다 — 잘린 글자를 "복사됐다" 로 붙이게 된다.
 */

export const OSC52_MAX_BYTES = 1024 * 1024;

const SELECTIONS = /^[cpqs0-7]*$/;

/** 공백은 부르는 쪽에서 이미 떼고 온다 */
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

/** `{ query: true }` 는 읽기 요청 — 쓰기와 갈라 "잘못된 base64" 와 헷갈리지 않게 알아보기만 한다 */
export type Osc52 = { selection: string; text: string } | { query: true };

/** `null` 은 "무시한다" — OSC 52 는 뜻이 하나뿐이라 핸들러는 어느 답에도 `true`(삼켰다)를 돌려준다 */
export function parseOsc52(data: string): Osc52 | null {
  const sep = data.indexOf(";");
  if (sep < 0) return null;
  const pc = data.slice(0, sep);
  const pd = data.slice(sep + 1);
  if (!SELECTIONS.test(pc)) return null;
  if (pd === "?") return { query: true };
  const text = decodeBase64Utf8(pd);
  if (text === null) return null;
  return { selection: pc === "" ? "s0" : pc, text };
}

/**
 * AI 타일에서는 성공을 말하지 않는다 — Claude Code · Codex 가 스스로 OSC 52 로 복사하고 "copied" 를 띄워 겹친다
 * (docs/log/2026-10-05-ai-tile-copy-note.md).
 */
export function osc52Note(ok: boolean, aiTile: boolean): "copied" | null {
  if (!ok || aiTile) return null;
  return "copied";
}

/** `fatal` 없이 푼다 — latin-1 로 집어 보내는 오래된 도구의 한 글자 때문에 복사 전체를 버리지 않는다 */
function decodeBase64Utf8(raw: string): string | null {
  const b64 = raw.replace(/\s+/g, "");
  if (!BASE64.test(b64)) return null;
  // atob 앞의 넉넉한 상한 — 정확한 판정은 아래 `bin.length` 가 한다. 여기서 빡빡하게 자르면 딱 상한만큼인 payload 가 거부된다.
  if (b64.length > Math.ceil(OSC52_MAX_BYTES / 3) * 4 + 4) return null;
  let bin: string;
  try {
    bin = atob(b64);
  } catch {
    return null;
  }
  if (bin.length > OSC52_MAX_BYTES) return null;
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder("utf-8").decode(bytes);
}
