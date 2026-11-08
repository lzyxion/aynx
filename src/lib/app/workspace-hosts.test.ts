import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ invoke: vi.fn(), request: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("$lib/workspaces/window-events", () => ({ requestWindow: mocks.request }));
import { rewriteWorkspaceHosts } from "./workspace-hosts";
let events: string[];
beforeEach(() => {
  events = [];
  mocks.invoke.mockReset().mockImplementation(async (cmd: string) => {
    events.push(cmd);
    return cmd === "workspace_windows" ? ["main", "aux"] : 2;
  });
  mocks.request.mockReset().mockImplementation(async (label: string, action: { kind: string }) => {
    events.push(label + ":" + action.kind);
    return true;
  });
});
it("전체 창 pause ACK 뒤 한 변경을 쓰고 메모리 ACK 뒤 저장을 재개한다", async () => {
  await rewriteWorkspaceHosts(["old"], "new");
  expect(events).toEqual(["workspace_windows", "main:pause", "aux:pause", "workspaces_apply", "main:hostAliases", "aux:hostAliases", "main:resume", "aux:resume"]);
  expect(mocks.invoke).toHaveBeenLastCalledWith("workspaces_apply", { mutation: { op: "rewriteHostAliases", aliases: ["old"], to: "new" } });
});
it("commit 뒤 메모리 ACK를 잃으면 구형 화면의 저장을 재개하지 않는다", async () => {
  mocks.request.mockImplementation(async (label: string, action: { kind: string }) => {
    events.push(label + ":" + action.kind);
    return action.kind !== "hostAliases" || label !== "aux";
  });
  await expect(rewriteWorkspaceHosts(["old"])).rejects.toThrow("workspaceHostAckFailed");
  expect(events).toContain("workspaces_apply");
  expect(events.some((event) => event.endsWith(":resume"))).toBe(false);
});
it("commit 전 실패는 이미 멈춘 창을 재개하고 파일을 쓰지 않는다", async () => {
  mocks.request.mockImplementation(async (label: string, action: { kind: string }) => {
    events.push(label + ":" + action.kind);
    return label !== "aux";
  });
  await expect(rewriteWorkspaceHosts(["old"])).rejects.toThrow("workspacePauseFailed");
  expect(events).not.toContain("workspaces_apply");
  expect(events.at(-1)).toBe("main:resume");
});
it("같은 창에서 동시에 요청해도 다음 요청은 이전 resume 뒤 시작한다", async () => {
  await Promise.all([rewriteWorkspaceHosts(["first"]), rewriteWorkspaceHosts(["second"])]);
  expect(events.filter((event) => event === "workspaces_apply")).toHaveLength(2);
  expect(events.indexOf("workspace_windows", 1)).toBe(events.indexOf("aux:resume") + 1);
});
