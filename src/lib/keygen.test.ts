import { describe, expect, it } from "vitest";
import { defaultKeyName, keyFileName } from "./keygen";
import { keyFileLabel } from "./copyid";
import type { KeyFile } from "./keygen";

/**
 * 키 생성 흐름의 **순수 함수들** (docs/log/2026-09-17-keygen.md).
 *
 * 이름·종류 규칙 자체는 백엔드가 단일 진실이라 여기서 검증하지 않는다 (`keygen.rs` 의
 * `validate_name`). 프런트가 지는 약속은 하나뿐이다 — **이미 있는 이름을 제안하지 않는다.**
 * 백엔드가 덮어쓰기를 거절하므로, 그 약속이 깨지면 사용자는 모달을 열자마자 빨간 줄을 본다.
 */

const file = (privatePath: string, comment = ""): KeyFile => ({
  privatePath,
  publicPath: `${privatePath}.pub`,
  fingerprint: "SHA256:aaaa",
  comment,
  kind: "ssh-ed25519",
  publicLine: "ssh-ed25519 AAAA",
});

describe("keyFileName", () => {
  it("두 구분자를 모두 알아본다 (윈도우 경로와 POSIX 경로가 한 화면에 섞인다)", () => {
    expect(keyFileName("C:\\Users\\wl\\.ssh\\id_ed25519")).toBe("id_ed25519");
    expect(keyFileName("/home/wl/.ssh/id_ed25519")).toBe("id_ed25519");
    // 구분자가 없으면 그 자체가 이름이다.
    expect(keyFileName("id_ed25519")).toBe("id_ed25519");
    expect(keyFileName("")).toBe("");
  });
});

describe("defaultKeyName", () => {
  it("비어 있으면 기본 이름 그대로", () => {
    expect(defaultKeyName([])).toBe("id_ed25519");
    expect(defaultKeyName([], "web-01")).toBe("id_ed25519");
    expect(defaultKeyName(["id_rsa", "known_hosts"], "web-01")).toBe("id_ed25519");
  });

  it("기본 이름이 이미 있으면 별칭을 잇는다", () => {
    expect(defaultKeyName(["id_ed25519"], "web01")).toBe("id_ed25519_web01");
  });

  it("별칭에 파일 이름으로 못 쓰는 글자가 있으면 다듬는다", () => {
    // 호스트 별칭에는 `~/.ssh/config` 가 허용하는 것이 전부 온다 — 그대로 이으면 백엔드의
    // 이름 검증이 곧바로 거절한다.
    expect(defaultKeyName(["id_ed25519"], "prod/web-01")).toBe("id_ed25519_prod_web-01");
    expect(defaultKeyName(["id_ed25519"], "user@bastion:2222")).toBe("id_ed25519_user_bastion_2222");
    // 앞뒤로 남은 구분자는 떨어진다 (`id_ed25519__` 같은 꼬리가 생기지 않게).
    expect(defaultKeyName(["id_ed25519"], "  .box.  ")).toBe("id_ed25519_box");
  });

  it("별칭까지 겹치면 번호를 2부터 붙인다", () => {
    expect(defaultKeyName(["id_ed25519", "id_ed25519_web01"], "web01")).toBe("id_ed25519_web01_2");
    expect(
      defaultKeyName(["id_ed25519", "id_ed25519_web01", "id_ed25519_web01_2"], "web01"),
    ).toBe("id_ed25519_web01_3");
  });

  it("별칭이 없으면 기본 이름에 바로 번호를 붙인다", () => {
    expect(defaultKeyName(["id_ed25519"])).toBe("id_ed25519_2");
    expect(defaultKeyName(["id_ed25519"], "")).toBe("id_ed25519_2");
    // 별칭이 통째로 구분자뿐이면 없는 것과 같다.
    expect(defaultKeyName(["id_ed25519"], "///")).toBe("id_ed25519_2");
  });

  it("대소문자를 무시한다 — 윈도우 파일 시스템이 그렇다", () => {
    expect(defaultKeyName(["ID_ED25519"])).toBe("id_ed25519_2");
    expect(defaultKeyName(["id_ed25519", "ID_ED25519_WEB01"], "web01")).toBe("id_ed25519_web01_2");
  });
});

describe("keyFileLabel", () => {
  it("파일 이름이 앞이다 — 목록에서 키를 가르는 단서는 알고리즘이 아니라 이름이다", () => {
    expect(keyFileLabel(file("C:\\Users\\wl\\.ssh\\id_ed25519_web01", "wl@box"))).toBe(
      "id_ed25519_web01 · wl@box",
    );
    expect(keyFileLabel(file("/home/wl/.ssh/id_rsa"))).toBe("id_rsa");
    // 주석이 공백뿐이면 구분자만 덩그러니 남지 않는다.
    expect(keyFileLabel(file("/home/wl/.ssh/id_rsa", "   "))).toBe("id_rsa");
  });
});
