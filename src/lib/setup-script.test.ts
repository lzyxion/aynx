import { describe, expect, it } from "vitest";
import { newSetupNonce, parseSetupOsc, SETUP_OSC } from "$lib/setup-script";

// docs/log/2026-09-28-project-agent-setup-script.md — 설정 스크립트의 끝 신호(OSC 7717)
describe("parseSetupOsc — 끝 신호 읽기", () => {
  it("aynx-setup;<nonce>;<code> 만 받는다", () => {
    expect(SETUP_OSC).toBe(7717);
    expect(parseSetupOsc("aynx-setup;abcdef0123456789;0")).toEqual({ nonce: "abcdef0123456789", code: 0 });
    expect(parseSetupOsc("aynx-setup;ABCDEF01;7")).toEqual({ nonce: "abcdef01", code: 7 });
    expect(parseSetupOsc("aynx-setup;abcdef01;-1")).toEqual({ nonce: "abcdef01", code: -1 });
  });

  it("모양이 어긋나면 null — 다른 프로그램의 같은 번호 · 짧은 nonce · 숫자 아닌 코드 · 칸 수", () => {
    for (const bad of [
      "other;abcdef01;0",
      "aynx-setup;abc;0",
      "aynx-setup;zzzzzzzz;0",
      "aynx-setup;abcdef01;x",
      "aynx-setup;abcdef01;",
      "aynx-setup;abcdef01;0;extra",
      "aynx-setup;abcdef01",
      "",
    ]) {
      expect(parseSetupOsc(bad), bad).toBeNull();
    }
  });

  it("nonce 는 16진 32자이고 매번 다르다 (Rust `check_nonce` 를 지난다)", () => {
    const a = newSetupNonce();
    const b = newSetupNonce();
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(a).not.toBe(b);
    expect(parseSetupOsc(`aynx-setup;${a};0`)?.nonce).toBe(a);
  });
});
