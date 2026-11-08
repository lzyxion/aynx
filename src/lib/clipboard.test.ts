import { describe, expect, it } from "vitest";
import { clipboardReadFailure } from "$lib/clipboard";

/**
 * 플러그인 `read_text` 실패 → `readClipboard` 계약 (docs/log/2026-09-28-clipboard-plugin.md).
 * `""` = 붙여넣을 텍스트가 없다(조용히), `null` = 읽을 수 없었다(토스트).
 */
describe("clipboardReadFailure", () => {
  // arboard 3.x `Error::ContentNotAvailable` 의 Display — 플러그인이 이 문자열 하나로 직렬화한다.
  const EMPTY =
    "The clipboard contents were not available in the requested format or the clipboard is empty.";

  it("빈 클립보드·텍스트 아님은 빈 문자열", () => {
    expect(clipboardReadFailure(EMPTY)).toBe("");
    expect(clipboardReadFailure(new Error(EMPTY))).toBe("");
  });

  it("그 밖의 실패는 null", () => {
    expect(
      clipboardReadFailure(
        "The native clipboard is not accessible due to being held by another party.",
      ),
    ).toBeNull();
    expect(clipboardReadFailure("clipboard-manager.read_text not allowed")).toBeNull();
    expect(clipboardReadFailure(undefined)).toBeNull();
    expect(clipboardReadFailure({})).toBeNull();
  });
});
