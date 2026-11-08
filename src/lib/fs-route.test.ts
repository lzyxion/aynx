import { describe, expect, it } from "vitest";
import {
  dragMode,
  dropEffectOf,
  isRemoteKey,
  LOCAL_BACKEND_KEY,
  routeBetween,
  routeDoneLabel,
  routeLabel,
  sameTier,
} from "$lib/fs-route";

// 길과 뜻은 **다른 축**이다 (`fs-route.ts` 머리말) — 아래 표가 그 둘을 곱한 여덟 칸이다.

describe("isRemoteKey", () => {
  it("로컬 키 하나만 원격이 아니다", () => {
    expect(isRemoteKey(LOCAL_BACKEND_KEY)).toBe(false);
    expect(isRemoteKey("ssh:1")).toBe(true);
    expect(isRemoteKey("ssh:2")).toBe(true);
  });
});

describe("routeBetween", () => {
  it("같은 키면 제자리다 (원격끼리든 로컬끼리든)", () => {
    expect(routeBetween("ssh:1", "ssh:1")).toBe("same");
    expect(routeBetween(LOCAL_BACKEND_KEY, LOCAL_BACKEND_KEY)).toBe("same");
  });

  it("로컬 → 원격은 업로드, 원격 → 로컬은 다운로드", () => {
    expect(routeBetween(LOCAL_BACKEND_KEY, "ssh:1")).toBe("upload");
    expect(routeBetween("ssh:1", LOCAL_BACKEND_KEY)).toBe("download");
  });

  it("서로 다른 원격 사이는 between (바이트가 우리를 통해 흐른다)", () => {
    expect(routeBetween("ssh:1", "ssh:2")).toBe("between");
  });
});

describe("routeLabel — 값은 문장이 아니라 **문구 키**다", () => {
  it("잘라내기는 **어느 길로 가든 이동**이다", () => {
    for (const route of ["same", "upload", "download", "between"] as const) {
      expect(routeLabel(route, "cut")).toBe("files.transfer.route.move");
    }
  });

  it("복사는 길이 곧 말이 된다", () => {
    expect(routeLabel("same", "copy")).toBe("files.transfer.route.copy");
    expect(routeLabel("upload", "copy")).toBe("files.transfer.route.upload");
    expect(routeLabel("download", "copy")).toBe("files.transfer.route.download");
    // 서버 사이도 사용자에게는 그냥 "복사" 다 (내부의 길 이름을 화면에 내지 않는다)
    expect(routeLabel("between", "copy")).toBe("files.transfer.route.copy");
  });
});

describe("routeDoneLabel — 끝난 뒤 안내의 키 (같은 축, 다른 표)", () => {
  it("잘라내기는 어느 길로 가든 '이동했습니다'", () => {
    for (const route of ["same", "upload", "download", "between"] as const) {
      expect(routeDoneLabel(route, "cut")).toBe("files.transfer.done.move");
    }
  });

  it("복사는 길이 곧 말이 된다", () => {
    expect(routeDoneLabel("same", "copy")).toBe("files.transfer.done.copy");
    expect(routeDoneLabel("upload", "copy")).toBe("files.transfer.done.upload");
    expect(routeDoneLabel("download", "copy")).toBe("files.transfer.done.download");
    expect(routeDoneLabel("between", "copy")).toBe("files.transfer.done.copy");
  });
});

describe("sameTier", () => {
  it("서버 ↔ 서버는 같은 계층 — 드래그의 기본 뜻이 이동이다", () => {
    expect(sameTier("ssh:1", "ssh:1")).toBe(true);
    expect(sameTier("ssh:1", "ssh:2")).toBe(true);
  });

  it("내 디스크 안도 같은 계층", () => {
    expect(sameTier(LOCAL_BACKEND_KEY, LOCAL_BACKEND_KEY)).toBe(true);
  });

  it("내 디스크 ↔ 서버는 계층을 넘는다 — 기본 뜻이 복사다", () => {
    expect(sameTier(LOCAL_BACKEND_KEY, "ssh:1")).toBe(false);
    expect(sameTier("ssh:1", LOCAL_BACKEND_KEY)).toBe(false);
  });
});

// 아래 열두 칸이 드래그 규칙의 전부다 (`fs-route.ts` 의 [`dragMode`] 머리말과 같은 표):
//
// | 끄는 곳 → 놓는 곳 | 수정키 없음 | `Ctrl` | `Shift` | `Ctrl+Shift` |
// | --- | --- | --- | --- | --- |
// | 같은 계층 (같은 서버 안 · 원격 A→원격 B · 내 디스크 안) | 이동 | 복사 | 이동 | 복사 |
// | 계층을 넘음 (내 디스크 ↔ 서버) | 복사 | 복사 | 이동 | 복사 |
// | 출발지를 모름 (남의 창) | 복사 | 복사 | 이동 | 복사 |

const NONE = { ctrl: false, shift: false };
const CTRL = { ctrl: true, shift: false };
const SHIFT = { ctrl: false, shift: true };
const BOTH = { ctrl: true, shift: true };

describe("dragMode", () => {
  it("같은 계층 · 수정키 없음 — 이동 (드래그의 기본 뜻)", () => {
    expect(dragMode("ssh:1", "ssh:1", NONE)).toBe("cut");
    expect(dragMode("ssh:1", "ssh:2", NONE)).toBe("cut");
    expect(dragMode(LOCAL_BACKEND_KEY, LOCAL_BACKEND_KEY, NONE)).toBe("cut");
  });

  it("같은 계층 · Ctrl — 복사 (탐색기의 관례)", () => {
    expect(dragMode("ssh:1", "ssh:1", CTRL)).toBe("copy");
    expect(dragMode("ssh:1", "ssh:2", CTRL)).toBe("copy");
    expect(dragMode(LOCAL_BACKEND_KEY, LOCAL_BACKEND_KEY, CTRL)).toBe("copy");
  });

  it("같은 계층 · Shift — 이동 (기본값과 같다 — 눌러도 뜻이 흔들리지 않는다)", () => {
    expect(dragMode("ssh:1", "ssh:1", SHIFT)).toBe("cut");
    expect(dragMode("ssh:1", "ssh:2", SHIFT)).toBe("cut");
    expect(dragMode(LOCAL_BACKEND_KEY, LOCAL_BACKEND_KEY, SHIFT)).toBe("cut");
  });

  it("같은 계층 · Ctrl+Shift — 복사 (Ctrl 이 먼저 이긴다)", () => {
    expect(dragMode("ssh:1", "ssh:1", BOTH)).toBe("copy");
    expect(dragMode("ssh:1", "ssh:2", BOTH)).toBe("copy");
    expect(dragMode(LOCAL_BACKEND_KEY, LOCAL_BACKEND_KEY, BOTH)).toBe("copy");
  });

  it("계층을 넘음 · 수정키 없음 — 복사 (가져오기 / 내보내기이지 옮기기가 아니다)", () => {
    expect(dragMode(LOCAL_BACKEND_KEY, "ssh:1", NONE)).toBe("copy");
    expect(dragMode("ssh:1", LOCAL_BACKEND_KEY, NONE)).toBe("copy");
  });

  it("계층을 넘음 · Ctrl — 복사", () => {
    expect(dragMode(LOCAL_BACKEND_KEY, "ssh:1", CTRL)).toBe("copy");
    expect(dragMode("ssh:1", LOCAL_BACKEND_KEY, CTRL)).toBe("copy");
  });

  it("계층을 넘음 · Shift — **이동** (항목 단위 원자 이동이라 명시하면 안전하다)", () => {
    expect(dragMode(LOCAL_BACKEND_KEY, "ssh:1", SHIFT)).toBe("cut");
    expect(dragMode("ssh:1", LOCAL_BACKEND_KEY, SHIFT)).toBe("cut");
  });

  it("계층을 넘음 · Ctrl+Shift — 복사 (탐색기의 링크가 우리에겐 없다)", () => {
    expect(dragMode(LOCAL_BACKEND_KEY, "ssh:1", BOTH)).toBe("copy");
    expect(dragMode("ssh:1", LOCAL_BACKEND_KEY, BOTH)).toBe("copy");
  });

  it("출발지를 모름 · 수정키 없음 — 복사 (계층을 모르면 원본을 지우지 않는 쪽)", () => {
    expect(dragMode(null, "ssh:1", NONE)).toBe("copy");
    expect(dragMode(null, LOCAL_BACKEND_KEY, NONE)).toBe("copy");
  });

  it("출발지를 모름 · Ctrl — 복사", () => {
    expect(dragMode(null, "ssh:1", CTRL)).toBe("copy");
    expect(dragMode(null, LOCAL_BACKEND_KEY, CTRL)).toBe("copy");
  });

  it("출발지를 모름 · Shift — 이동 (명시적 몸짓은 출발지를 몰라도 명시적이다)", () => {
    expect(dragMode(null, "ssh:1", SHIFT)).toBe("cut");
    expect(dragMode(null, LOCAL_BACKEND_KEY, SHIFT)).toBe("cut");
  });

  it("출발지를 모름 · Ctrl+Shift — 복사", () => {
    expect(dragMode(null, "ssh:1", BOTH)).toBe("copy");
    expect(dragMode(null, LOCAL_BACKEND_KEY, BOTH)).toBe("copy");
  });
});

describe("dropEffectOf", () => {
  it("뜻 하나가 커서 하나로 — 예고와 결과가 갈릴 자리가 없다", () => {
    expect(dropEffectOf("cut")).toBe("move");
    expect(dropEffectOf("copy")).toBe("copy");
  });
});
