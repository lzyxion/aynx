import { readText } from "@tauri-apps/plugin-clipboard-manager";

/**
 * OS 클립보드로 나가는 유일한 문(앱 내부 클립보드 `fs-clipboard` · `hosts-clipboard` 와 무관하다).
 * 읽기는 플러그인이다 — `navigator.clipboard.readText()` 는 WebView2 에서 허용/차단 권한 창을 띄운다. 쓰기는 웹 API 그대로.
 * 플러그인 권한은 `clipboard-manager:allow-read-text` 하나이고, 읽기는 사용자가 붙여넣을 때만 한다(OSC 52 읽기 요청에는 답하지 않는다).
 */

/** 빈 문자열도 그대로 쓴다 — "복사할 것이 없다" 는 판단은 호출부의 몫이다 */
export async function writeClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    console.warn("[aynx] 클립보드에 쓰지 못했습니다:", e);
    return false;
  }
}

/**
 * `ClipboardItem` 이 그림으로 받는 형식은 `image/png` 하나다. 값을 약속으로 받는 것은 사용자 활성화 때문이다 —
 * `clipboard.write` 는 누른 손에 붙어 바로 불려야 하고, 그림 바꾸기는 그 뒤에 끝나도 된다.
 */
export async function writeClipboardImage(png: Blob | Promise<Blob>): Promise<boolean> {
  try {
    await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
    return true;
  } catch (e) {
    console.warn("[aynx] 클립보드에 그림을 쓰지 못했습니다:", e);
    return false;
  }
}

/** `""` = 붙여넣을 텍스트가 없다(비었거나 이미지뿐), `null` = 읽을 수 없었다 — 호출부는 뒤쪽에서만 오류를 알린다 */
export async function readClipboard(): Promise<string | null> {
  try {
    return await readText();
  } catch (e) {
    const mapped = clipboardReadFailure(e);
    if (mapped === null) console.warn("[aynx] 클립보드를 읽지 못했습니다:", e);
    return mapped;
  }
}

/**
 * 플러그인은 클립보드가 비었거나 텍스트가 아닐 때도 오류 문장을 던진다(`arboard::Error::ContentNotAvailable`) — 그것은 `""`.
 * 오류가 문자열 하나로만 오니 문장 비교뿐이다 — 문장이 바뀌면 빈 클립보드가 토스트로 보일 뿐이다.
 */
export function clipboardReadFailure(e: unknown): "" | null {
  const msg = typeof e === "string" ? e : e instanceof Error ? e.message : "";
  return /not available in the requested format|clipboard is empty/i.test(msg) ? "" : null;
}
