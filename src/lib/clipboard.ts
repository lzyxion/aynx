import { readText } from "@tauri-apps/plugin-clipboard-manager";

/**
 * **OS 클립보드로 나가는 유일한 문**
 * (docs/log/2026-09-05-terminal-context-menu.md · docs/log/2026-09-28-clipboard-plugin.md).
 *
 * 앱 안에는 클립보드가 둘 있다. 하나는 `fs-clipboard.svelte.ts`·`hosts-clipboard.svelte.ts`
 * 의 **앱 내부 클립보드**(복사/잘라내기한 파일·호스트를 들고 있는 모듈 상태)이고, 다른
 * 하나가 이것 — **OS 의 클립보드**다. 둘은 이름만 같지 서로 아무 관계가 없다.
 *
 * ## 왜 모듈 하나로 모으나
 *
 * 예전에는 `navigator.clipboard.writeText(...)` 를 각자 `try/catch` 로 감싼 자리가 둘
 * (`shell-integration.copyOutput` · `browser/file-actions.ts` 의 `copyPath`)이었다. 터미널 컨텍스트 메뉴가
 * 붙으면서 **읽기**(붙여넣기)까지 필요해졌고, 쓰는 자리도 넷으로 늘었다. 실패를 어떻게
 * 다루는지가 자리마다 달라지면 "복사가 조용히 안 됐다" 를 쫓을 곳이 없어진다.
 *
 * ## 읽기는 `@tauri-apps/plugin-clipboard-manager`, 쓰기는 웹 API
 *
 * 처음엔 둘 다 `navigator.clipboard` 였다(플러그인 의존성 하나를 아끼려고). 그런데
 * `navigator.clipboard.readText()` 는 WebView2 에서 **"클립보드에 복사된 텍스트와 이미지를
 * 보려고 합니다 — 허용/차단" 권한 창**을 띄운다 — 사용자 활성화 안이어도 그렇고, 고른 답도
 * 믿을 만하게 기억되지 않는다. 우클릭 붙여넣기·메뉴의 붙여넣기·앱 단축키가 다 이 길이었다.
 * (`Ctrl+V` 는 창이 뜨지 않았다 — 그건 브라우저가 직접 만든 `paste` 이벤트라 페이지가
 * 클립보드를 "읽는" 것이 아니다.) 그래서 **읽기만** 플러그인(Rust 의 `arboard`)으로 옮겼다.
 *
 * - **OS 분기 없음.** 플러그인이 Windows·Linux(X11·Wayland)·macOS 를 다 받으므로 `#[cfg]`
 *   코드가 생기지 않는다. WebView2 의 `PermissionRequested` 를 가로채는 길은 Windows 전용
 *   `#[cfg]` 코드라 버렸다(프로젝트의 전 OS 규칙).
 * - **권한은 `clipboard-manager:allow-read-text` 하나**(capabilities/default.json). 쓰기·
 *   이미지·HTML 은 열지 않는다. 읽기는 여전히 **사용자가 명시적으로 붙여넣을 때만**
 *   일어난다 — 부르는 곳은 `Terminal.svelte` 의 `pasteFromClipboard` 하나다. OSC 52 의
 *   읽기 요청(`?`)은 여전히 아무 답도 내지 않는다(docs/log/2026-09-23-osc52-osc8.md).
 * - **쓰기는 `navigator.clipboard.writeText` 그대로.** 쓰기는 권한 창을 띄우지 않고, 사용자
 *   활성화 안에서 잘 동작한다 — 옮길 까닭이 없고, 권한도 하나 덜 연다.
 *
 * 실패를 던지지 않는 이유는 호출부가 전부 UI 라서다 — 사용자에게 보여 줄 한 줄이
 * 필요하지 스택 트레이스가 필요한 게 아니다 (`CopyResult` 와 같은 판단).
 */

/**
 * 클립보드에 텍스트를 쓴다. 성공하면 `true`.
 *
 * 빈 문자열도 그대로 쓴다 — "복사할 것이 없다" 는 판단은 호출부의 몫이다 (그쪽만이
 * 무엇을 복사하려 했는지 안다).
 */
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
 * 클립보드에 **그림 한 장**(PNG)을 쓴다 — 문서 · 사이드 채팅 그림의 [이미지 복사](`image-actions.ts`). 성공하면 `true`.
 *
 * PNG 만 받는다: 웹 표준 `ClipboardItem` 이 그림으로 받는 형식은 `image/png` 하나다(WebView2 · 브라우저 모두 — 다른 형식은
 * 부르는 쪽이 캔버스로 PNG 로 바꿔 온다). 값을 **약속으로** 받을 수 있게 둔 것은 사용자 활성화 때문이다 — `clipboard.write` 는
 * 누른 손에 붙어 바로 불려야 하고, 그림 바꾸기(디코드 · 캔버스)는 그 뒤에 끝나도 된다. 쓰기 권한은 텍스트와 같은 웹 API 라
 * 플러그인 권한을 하나도 열지 않는다(위 머리말의 쓰기 규칙).
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

/**
 * 클립보드의 텍스트를 읽는다. 못 읽으면 `null` — **빈 문자열과 다르다**:
 * `""` 는 "붙여넣을 텍스트가 없다"(비었거나 이미지뿐), `null` 은 "읽을 수 없었다"(다른
 * 프로그램이 클립보드를 쥐고 있음·권한 없음 등)이고 호출부는 뒤쪽에서만 오류를 알린다.
 */
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
 * 플러그인 `read_text` 의 실패를 [`readClipboard`] 의 계약으로 옮긴다 — 순수 함수(테스트용).
 *
 * 플러그인은 클립보드가 **비었거나 텍스트가 아닐 때**(이미지만 복사한 경우 등)에도 값 대신
 * 오류를 던진다: `arboard::Error::ContentNotAvailable` 의 문장이 문자열로 넘어온다. 그것은
 * "읽을 수 없었다" 가 아니라 "붙여넣을 텍스트가 없다" 이므로 `""` — 예전 웹 API 가 같은
 * 경우에 돌려주던 값과 같고, 호출부(`requestPaste`)는 조용히 아무것도 하지 않는다.
 * 그 밖의 오류(클립보드 점유·권한 거부·초기화 실패)는 `null` 이라 토스트가 뜬다.
 *
 * 문장 비교가 깨지기 쉬운 것은 안다 — 플러그인이 오류를 **문자열 하나로만** 직렬화해 달리
 * 가를 방법이 없다. 문장이 바뀌면 빈 클립보드가 토스트로 보일 뿐(조용히 삼키지는 않는다).
 */
export function clipboardReadFailure(e: unknown): "" | null {
  const msg = typeof e === "string" ? e : e instanceof Error ? e.message : "";
  return /not available in the requested format|clipboard is empty/i.test(msg) ? "" : null;
}
