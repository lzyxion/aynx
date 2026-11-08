import { describe, expect, it } from "vitest";
import { looksLikeAddress, parseQuickConnect, quickConnectLabel } from "$lib/quick-connect";

describe("parseQuickConnect — 받아들이는 문법", () => {
  it("호스트 하나", () => {
    expect(parseQuickConnect("example.com")).toEqual({ host: "example.com" });
    expect(parseQuickConnect("10.0.0.7")).toEqual({ host: "10.0.0.7" });
    expect(parseQuickConnect("web-01")).toEqual({ host: "web-01" });
  });

  it("user@host", () => {
    expect(parseQuickConnect("deploy@example.com")).toEqual({
      user: "deploy",
      host: "example.com",
    });
  });

  it("user@host:port", () => {
    expect(parseQuickConnect("deploy@example.com:2222")).toEqual({
      user: "deploy",
      host: "example.com",
      port: 2222,
    });
    expect(parseQuickConnect("example.com:2222")).toEqual({ host: "example.com", port: 2222 });
  });

  it("앞의 ssh 는 있어도 되고 없어도 된다", () => {
    expect(parseQuickConnect("ssh deploy@example.com")).toEqual({
      user: "deploy",
      host: "example.com",
    });
    expect(parseQuickConnect("SSH deploy@example.com")).toEqual({
      user: "deploy",
      host: "example.com",
    });
    // 단독 `ssh` 는 그냥 호스트 이름으로 읽힌다 (문법상 구분할 근거가 없다).
    expect(parseQuickConnect("ssh")).toEqual({ host: "ssh" });
  });

  it("-p 는 대상 앞에도 뒤에도 올 수 있다", () => {
    const want = { user: "deploy", host: "example.com", port: 2222 };
    expect(parseQuickConnect("ssh -p 2222 deploy@example.com")).toEqual(want);
    expect(parseQuickConnect("ssh deploy@example.com -p 2222")).toEqual(want);
    expect(parseQuickConnect("-p 2222 deploy@example.com")).toEqual(want);
  });

  it("-p 와 :port 가 같으면 그대로, 다르면 거절", () => {
    expect(parseQuickConnect("ssh example.com:2222 -p 2222")).toEqual({
      host: "example.com",
      port: 2222,
    });
    expect(parseQuickConnect("ssh example.com:2222 -p 22")).toBeNull();
  });

  it("앞뒤 공백은 버린다", () => {
    expect(parseQuickConnect("   example.com  ")).toEqual({ host: "example.com" });
  });

  it("대괄호 IPv6", () => {
    expect(parseQuickConnect("[::1]")).toEqual({ host: "::1" });
    expect(parseQuickConnect("[::1]:22")).toEqual({ host: "::1", port: 22 });
    expect(parseQuickConnect("deploy@[fe80::1]:2222")).toEqual({
      user: "deploy",
      host: "fe80::1",
      port: 2222,
    });
  });
});

describe("parseQuickConnect — 거절하는 것", () => {
  const rejected = [
    "",
    "   ",
    // 셸 메타문자·따옴표 — 이 값은 호스트 이름으로 네트워크와 known_hosts 에 실린다
    "example.com; rm -rf /",
    "example.com && whoami",
    "example.com|tee",
    "$(id)",
    "`id`",
    'a"b',
    "a'b",
    // 경로·URL
    "ssh://example.com",
    "./example.com",
    "C:\\path",
    "example.com/path",
    // 우리가 해석하지 않는 플래그는 **조용히 버리지 않는다** (버리면 뜻이 달라진다)
    "ssh -J bastion deploy@example.com",
    "ssh -i ~/.ssh/id_ed25519 example.com",
    "ssh -p2222 example.com",
    "ssh -p example.com",
    "ssh -p 0 example.com",
    "ssh -p 70000 example.com",
    "ssh -p 22 -p 22 example.com",
    // 대상이 둘
    "example.com other.example",
    // 호스트 모양이 아닌 것
    "-example.com",
    "example-.com",
    "exa mple.com",
    "example..com",
    "한글호스트",
    "@example.com",
    "deploy@",
    "example.com:",
    "example.com:abc",
    "example.com:99999",
    // 대괄호 없는 IPv6 — 포트와 구분할 수 없다
    "::1",
    "fe80::1:22",
    // 닫히지 않은 대괄호
    "[::1",
    "[::1]x",
    // 대괄호 안이 IPv6 이 아니다
    "[example.com]:22",
  ];

  for (const input of rejected) {
    it(`거절: ${JSON.stringify(input)}`, () => {
      expect(parseQuickConnect(input)).toBeNull();
    });
  }
});

describe("quickConnectLabel", () => {
  it("적은 것만 보여 준다 (22 번은 생략)", () => {
    expect(quickConnectLabel({ host: "example.com" })).toBe("example.com");
    expect(quickConnectLabel({ user: "deploy", host: "example.com" })).toBe("deploy@example.com");
    expect(quickConnectLabel({ user: "deploy", host: "example.com", port: 22 })).toBe(
      "deploy@example.com",
    );
    expect(quickConnectLabel({ user: "deploy", host: "example.com", port: 2222 })).toBe(
      "deploy@example.com:2222",
    );
    expect(quickConnectLabel({ host: "::1", port: 2222 })).toBe("::1:2222");
  });

  it("파싱한 것을 다시 파싱해도 같은 대상이다", () => {
    for (const input of ["deploy@example.com:2222", "example.com", "deploy@example.com"]) {
      const target = parseQuickConnect(input);
      expect(target).not.toBeNull();
      expect(parseQuickConnect(quickConnectLabel(target!))).toEqual(target);
    }
  });
});

describe("looksLikeAddress — 팔레트가 한 겹 더 보는 표시", () => {
  it("사용자·포트·도메인·IPv6·명령 형태면 주소로 본다", () => {
    for (const s of [
      "deploy@example.com",
      "example.com:2222",
      "example.com",
      "10.0.0.7",
      "[::1]",
      "ssh web",
      "-p 22 web",
    ]) {
      expect(looksLikeAddress(s), s).toBe(true);
    }
  });

  it("맨낱말은 주소로 보지 않는다 — `web-01` 을 찾느라 친 `web` 이 여기 걸린다", () => {
    for (const s of ["", "   ", "web", "web-01", "prod"]) {
      expect(looksLikeAddress(s), s).toBe(false);
    }
  });

  it("문법 통과와는 다른 물음이다 (맨낱말도 파싱은 된다)", () => {
    expect(parseQuickConnect("web")).toEqual({ host: "web" });
    expect(looksLikeAddress("web")).toBe(false);
  });
});
