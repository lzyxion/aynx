import { vi } from "vitest";

// Tauri 스텁 — 순수 모듈이라도 **파일 맨 위에서** `invoke`·`Channel` 을 import 하는 이상
// 모듈을 들여오는 것만으로 `@tauri-apps/api` 의 초기화 코드가 돈다. 그쪽은 `window.__TAURI_INTERNALS__`
// 를 전제하므로 node 환경에서는 그 자리에서 터진다.
//
// 규칙: **테스트 대상은 순수 함수뿐이므로 스텁은 "불리면 안 되는 것" 이다.**
// `invoke` 는 빈 약속을, `Channel` 은 아무것도 하지 않는 껍데기를 돌려준다. 어떤 테스트가
// 실제로 백엔드를 부르기 시작하면 `undefined` 를 받아 곧바로 실패한다 — 조용히 통과하지 않는다.
// 반환값을 케이스별로 바꿔야 하면 그 테스트 파일에서 `vi.mocked(invoke).mockResolvedValue(...)`.

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => undefined),
  Channel: class {
    onmessage: ((msg: unknown) => void) | null = null;
    toJSON() {
      return "__CHANNEL__:0";
    }
  },
  convertFileSrc: (p: string) => p,
  transformCallback: () => 0,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
  emit: vi.fn(async () => undefined),
  once: vi.fn(async () => () => {}),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: vi.fn(() => ({
    label: "main",
    listen: vi.fn(async () => () => {}),
  })),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(async () => undefined),
  openPath: vi.fn(async () => undefined),
  revealItemInDir: vi.fn(async () => undefined),
}));

// 앱 확인 · 알림 상자(`app/confirm-dialog` — 10-16 전에는 위 플러그인의 ask · message) — 그리는 컴포넌트가 없는 시험에서
// 기다리면 영영 끝나지 않으므로 플러그인 스텁과 같은 답(취소)을 곧바로 준다. 줄 · 결과 자체의 시험은 그 파일이 `vi.unmock` 한다.
// 모듈 상태(`$state`)라 진짜를 들여오지 않고 통째로 갈아 끼운다.
vi.mock("$lib/app/confirm-dialog.svelte.js", () => ({
  confirmDialogOpen: () => false,
  currentConfirm: () => null,
  answerConfirm: () => {},
  dismissConfirm: () => {},
  confirmAcked: () => false,
  setConfirmAcked: () => {},
  ackBlocks: () => false,
  askConfirm: vi.fn(async () => false),
  showMessage: vi.fn(async () => undefined),
  askChoice: vi.fn(async () => "Cancel"),
  askHookInstall: vi.fn(async () => false),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  ask: vi.fn(async () => false),
  confirm: vi.fn(async () => false),
  message: vi.fn(async () => undefined),
  open: vi.fn(async () => null),
  save: vi.fn(async () => null),
}));
