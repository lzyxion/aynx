import { expect, vi } from "vitest";

type Listener = () => void;

/**
 * DOM 없는 시험용 `<input type="file">` — `$lib/browser/device-pick` 의 `pickDeviceFiles` 를 시험한다. `click()` 이 불리면 다음 틱에
 * 정해 둔 결과(`change` 파일 또는 `cancel`)를 낸다(고르기 창은 나중에 닫힌다). `document` 를 갈아 끼우므로 시험 파일은
 * `afterEach(() => vi.unstubAllGlobals())` 를 둔다.
 */
export function fakeFileInput(outcome: { files: File[] } | "cancel") {
  const seen = { clicked: 0, attached: 0, removed: 0, input: null as null | Record<string, unknown> };
  const listeners: Record<string, Listener> = {};
  const input = {
    type: "",
    multiple: false,
    accept: "",
    tabIndex: 0,
    style: { cssText: "" },
    files: null as File[] | null,
    setAttribute: () => {},
    addEventListener: (ev: string, fn: Listener) => (listeners[ev] = fn),
    remove: () => seen.removed++,
    click: () => {
      seen.clicked++;
      queueMicrotask(() => {
        if (outcome === "cancel") listeners.cancel?.();
        else {
          input.files = outcome.files;
          listeners.change?.();
        }
      });
    },
  };
  seen.input = input;
  vi.stubGlobal("document", {
    createElement: (tag: string) => {
      expect(tag).toBe("input");
      return input;
    },
    body: { appendChild: () => seen.attached++ },
  });
  return seen;
}
