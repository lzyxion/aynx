import { describe, expect, it, vi } from "vitest";
import { saveAndReflect, settleSettingsClose, type CloseAnswer } from "./settings-close";

/** 저장의 목 — 무엇이 어떤 순서로 불렸는지 `log` 에 적는다 */
function saveDeps(profile: string | null, written = true) {
  const log: string[] = [];
  return {
    log,
    write: vi.fn(async () => (log.push("write"), written)),
    modifiedProfile: vi.fn(async () => profile),
    reflect: vi.fn((id: string) => void log.push(`reflect:${id}`)),
  };
}

describe("설정 저장 = 고른 테마 프로필에도 반영 (묻지 않음)", () => {
  it("저장이 성공하고 프로필이 다르면 저장 뒤 반영한다", async () => {
    const d = saveDeps("P1");
    expect(await saveAndReflect(d)).toBe(true);
    expect(d.log).toEqual(["write", "reflect:P1"]);
  });

  it("저장이 실패하면 반영하지 않는다", async () => {
    const d = saveDeps("P1", false);
    expect(await saveAndReflect(d)).toBe(false);
    expect(d.reflect).not.toHaveBeenCalled();
    expect(d.modifiedProfile).not.toHaveBeenCalled();
  });

  it("고른 프로필이 없거나 모양이 같으면 반영 · 알림이 없다", async () => {
    const d = saveDeps(null);
    expect(await saveAndReflect(d)).toBe(true);
    expect(d.log).toEqual(["write"]);
  });
});

/** 닫기의 목 — `save` 는 위의 저장 길(반영 포함)을 그대로 쓴다 */
function closeDeps(dirty: boolean, answer: CloseAnswer, profile: string | null = "P1", written = true) {
  const s = saveDeps(profile, written);
  const revert = vi.fn(() => void s.log.push("revert"));
  return {
    ...s,
    dirty: () => dirty,
    ask: vi.fn(async () => (s.log.push("ask"), answer)),
    save: () => saveAndReflect(s),
    revert,
  };
}

describe("설정 닫기 = [취소] · 미저장이면 저장할지 한 번 묻기", () => {
  it("미저장 변경이 없으면 묻지 않고 닫는다", async () => {
    const d = closeDeps(false, "Cancel");
    expect(await settleSettingsClose(d)).toBe(true);
    expect(d.log).toEqual([]);
  });

  it("[저장] — 저장 길 그대로(프로필 반영 포함) 뒤 닫는다", async () => {
    const d = closeDeps(true, "Yes");
    expect(await settleSettingsClose(d)).toBe(true);
    expect(d.log).toEqual(["ask", "write", "reflect:P1"]);
  });

  it("[저장] 이 실패하면 닫지 않고 반영도 없다", async () => {
    const d = closeDeps(true, "Yes", "P1", false);
    expect(await settleSettingsClose(d)).toBe(false);
    expect(d.log).toEqual(["ask", "write"]);
  });

  it("[저장 안 함] — 되돌린 뒤 닫는다(프로필은 건드리지 않는다)", async () => {
    const d = closeDeps(true, "No");
    expect(await settleSettingsClose(d)).toBe(true);
    expect(d.log).toEqual(["ask", "revert"]);
  });

  it("물리면(Escape · 바깥 누르기 · [계속 편집]) 닫지 않고 아무것도 바꾸지 않는다", async () => {
    const d = closeDeps(true, "Cancel");
    expect(await settleSettingsClose(d)).toBe(false);
    expect(d.log).toEqual(["ask"]);
  });
});
