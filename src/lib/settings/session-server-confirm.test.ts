import { describe, expect, it } from "vitest";
import { serverConfirm } from "$lib/settings/session-server-confirm";

describe("serverConfirm", () => {
  it("세션이 0개면 묻지 않는다", () => {
    expect(serverConfirm("closeAll", 0)).toBeNull();
    expect(serverConfirm("restart", 0)).toBeNull();
  });

  it("세션이 있으면 수를 실어 묻는다", () => {
    expect(serverConfirm("closeAll", 3)).toEqual({
      message: "settings.general.server.close_all.ask",
      params: { count: 3 },
      ok: "settings.general.server.close_all",
    });
    expect(serverConfirm("restart", 1)).toEqual({
      message: "settings.general.server.restart.ask",
      params: { count: 1 },
      ok: "settings.general.server.restart",
    });
  });

  it("수를 모르면 수 없이 묻는다", () => {
    expect(serverConfirm("closeAll", null)?.message).toBe("settings.general.server.close_all.ask.unknown");
    expect(serverConfirm("restart", undefined)?.message).toBe("settings.general.server.restart.ask.unknown");
  });
});
