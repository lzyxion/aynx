import { describe, expect, it, vi } from "vitest";

vi.mock("$lib/i18n/i18n.svelte.js", () => ({
  t: (key: string, args?: Record<string, string>) => (args?.name ? `${key}(${args.name})` : key),
}));

import { askConfirm } from "$lib/app/confirm-dialog.svelte.js";
import { confirmApproveAll } from "./approve-all-confirm";

describe("모두 승인 확인 상자(10-23 게이지 목업)", () => {
  it("경고 · 위험(첫 포커스 [취소]) · 게이지 미리 보기 · 점 목록 넷 · 「이해했습니다」 칸 — 이름은 머리 · 칸에", async () => {
    const ask = vi.mocked(askConfirm);
    ask.mockClear();
    expect(await confirmApproveAll("host", "dev-01")).toBe(false);
    const [body, opts] = ask.mock.calls[0];
    expect(body).toBe("app.ai.all.confirm.host");
    expect(opts).toMatchObject({
      title: "app.ai.all.confirm.title(dev-01)",
      kind: "warning",
      danger: true,
      variant: "approve-all",
      ack: "app.ai.all.confirm.ack(dev-01)",
    });
    expect(opts?.points).toEqual([
      "app.ai.all.confirm.host.p1",
      "app.ai.all.confirm.host.p2",
      "app.ai.all.confirm.host.p3",
      "app.ai.all.confirm.switch",
    ]);
    // 집 PC 창 — 원격 웹 꼬리말 없음
    expect(opts?.footnote).toBeUndefined();
  });

  it("DB 연결은 DB 뜻의 한 줄 · 목록", async () => {
    const ask = vi.mocked(askConfirm);
    ask.mockClear();
    await confirmApproveAll("db", "운영 DB");
    const [body, opts] = ask.mock.calls[0];
    expect(body).toBe("app.ai.all.confirm.db");
    expect(opts?.points?.[0]).toBe("app.ai.all.confirm.db.p1");
    expect(opts?.points?.[3]).toBe("app.ai.all.confirm.switch");
  });
});
