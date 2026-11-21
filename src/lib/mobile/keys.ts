// 모바일 키 띠의 바이트 — 순수 모듈. 보내는 길은 터미널의 사람 입력 문(`term-actions` 의 `typeKeys` — 출처 `keyboard`) 하나다.

/** Ctrl 은 키가 아니라 상태다(`ctrl` 인자) */
export type BandKey = "esc" | "tab" | "up" | "down" | "left" | "right" | "ctrlC" | "enter";

export const BAND_KEYS: readonly BandKey[] = ["esc", "tab", "up", "down", "left", "right", "ctrlC", "enter"];

export interface BandMods {
  ctrl: boolean;
  /** 응용 커서 키 모드(DECCKM) — 화살표가 `ESC O x` 가 된다 */
  appCursor: boolean;
}

const ARROW: Record<"up" | "down" | "right" | "left", string> = { up: "A", down: "B", right: "C", left: "D" };

export function bandKeyBytes(key: BandKey, mods: BandMods): string {
  switch (key) {
    case "esc":
      return "\x1b";
    case "tab":
      return "\t";
    case "enter":
      return "\r";
    case "ctrlC":
      return "\x03";
    default: {
      const c = ARROW[key];
      if (mods.ctrl) return `\x1b[1;5${c}`;
      return mods.appCursor ? `\x1bO${c}` : `\x1b[${c}`;
    }
  }
}

/** 붙일 수 없으면 `null` — 부르는 쪽이 원래 글을 그대로 보내고 Ctrl 을 푼다 */
export function ctrlOf(data: string): string | null {
  if (data.length !== 1) return null;
  const code = data.charCodeAt(0);
  if (code >= 0x61 && code <= 0x7a) return String.fromCharCode(code - 0x60); // a-z
  if (code >= 0x40 && code <= 0x5f) return String.fromCharCode(code - 0x40); // @ A-Z [ \ ] ^ _
  if (data === " " || data === "2") return "\x00";
  if (data === "?") return "\x7f";
  if (data === "/") return "\x1f";
  return null;
}
