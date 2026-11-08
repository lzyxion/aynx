import { describe, expect, it } from "vitest";
import {
  HOST_FORM_TABS,
  tabOfField,
  validateHostForm,
  type HostFormValues,
} from "$lib/host-form-tabs";
import { MAX_SCROLLBACK, MIN_SCROLLBACK } from "$lib/session";

/** 호스트 폼의 칸 → 탭 표와 저장 전 검증 (docs/log/2026-09-20-host-form-tabs.md) */

describe("tabOfField", () => {
  it("접속 탭의 칸들", () => {
    for (const id of [
      "f-name",
      "f-hostname",
      "f-user",
      "f-port",
      "f-identity",
      "f-identities-only",
      "f-forward-agent",
      "f-proxy-jump",
      "f-vault-label",
    ]) {
      expect(tabOfField(id), id).toBe("connect");
    }
  });

  it("표시 탭의 칸들", () => {
    for (const id of ["f-color", "f-icon", "f-group", "f-tags"]) {
      expect(tabOfField(id), id).toBe("display");
    }
  });

  it("세션 탭의 칸들", () => {
    for (const id of [
      "f-scrollback",
      "f-onconnect",
      "f-tmux",
      "f-shellint",
      "f-log",
      "f-forwards-label",
    ]) {
      expect(tabOfField(id), id).toBe("session");
    }
  });

  it("에이전트 활성화 · 추가 인자는 에이전트 탭이다 (2026-10-26)", () => {
    for (const id of ["f-agent", "f-agent-args-claude", "f-agent-args-codex"]) {
      expect(tabOfField(id), id).toBe("agent");
    }
  });

  /**
   * 칸을 특정할 수 없는 실패(백엔드의 메타 저장 오류)는 `null` 로 온다 — 그때 탭을 빼앗지
   * 않는 것이 규칙이다. 모르는 id 도 같은 길로 떨어진다.
   */
  it("모르는 id·null·undefined 는 아무 탭도 아니다", () => {
    expect(tabOfField(null)).toBeNull();
    expect(tabOfField(undefined)).toBeNull();
    expect(tabOfField("")).toBeNull();
    expect(tabOfField("f-nope")).toBeNull();
    expect(tabOfField("name")).toBeNull();
  });

  it("검증이 가리키는 세 칸은 모두 표에 있다 (submitForm 과의 계약)", () => {
    for (const id of ["f-port", "f-scrollback", "f-forwards-label", "f-name"]) {
      expect(HOST_FORM_TABS).toContain(tabOfField(id));
    }
  });
});

/**
 * 저장 전 검증. 별칭·호스트 주소는 예전에 브라우저의 `required` 가 막던 것이다 — 탭으로
 * 갈리면서 그 길이 막혀(`<form novalidate>`) 여기로 내려왔다.
 */
describe("validateHostForm", () => {
  const ok: HostFormValues = { name: "web-01", hostName: "10.0.0.1", port: 22, scrollback: 5000 };

  it("다 채워져 있으면 null", () => {
    expect(validateHostForm(ok)).toBeNull();
  });

  it("포트·스크롤백은 비어 있어도 된다 (상속)", () => {
    expect(validateHostForm({ ...ok, port: null, scrollback: null })).toBeNull();
  });

  it("별칭이 비면 f-name", () => {
    expect(validateHostForm({ ...ok, name: "" })).toEqual({ field: "f-name", kind: "name" });
    expect(validateHostForm({ ...ok, name: "   " })).toEqual({ field: "f-name", kind: "name" });
  });

  it("호스트 주소가 비면 f-hostname", () => {
    expect(validateHostForm({ ...ok, hostName: "" })).toEqual({
      field: "f-hostname",
      kind: "hostname",
    });
  });

  it("칸 순서대로 본다 — 둘 다 비면 별칭이 먼저다", () => {
    expect(validateHostForm({ ...ok, name: "", hostName: "" })?.field).toBe("f-name");
  });

  it("포트 범위 (1–65535, 정수)", () => {
    expect(validateHostForm({ ...ok, port: 0 })?.field).toBe("f-port");
    expect(validateHostForm({ ...ok, port: 65536 })?.field).toBe("f-port");
    expect(validateHostForm({ ...ok, port: 22.5 })?.field).toBe("f-port");
    expect(validateHostForm({ ...ok, port: 1 })).toBeNull();
    expect(validateHostForm({ ...ok, port: 65535 })).toBeNull();
  });

  it("스크롤백 범위", () => {
    expect(validateHostForm({ ...ok, scrollback: MIN_SCROLLBACK - 1 })?.field).toBe("f-scrollback");
    expect(validateHostForm({ ...ok, scrollback: MAX_SCROLLBACK + 1 })?.field).toBe("f-scrollback");
    expect(validateHostForm({ ...ok, scrollback: MIN_SCROLLBACK })).toBeNull();
    expect(validateHostForm({ ...ok, scrollback: MAX_SCROLLBACK })).toBeNull();
  });

  it("걸린 칸은 언제나 탭을 아는 칸이다", () => {
    for (const bad of [
      { ...ok, name: "" },
      { ...ok, hostName: "" },
      { ...ok, port: 0 },
      { ...ok, scrollback: 1 },
    ]) {
      const problem = validateHostForm(bad);
      expect(problem).not.toBeNull();
      expect(HOST_FORM_TABS).toContain(tabOfField(problem?.field ?? null));
    }
  });
});
