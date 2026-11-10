import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { canSettleUnlockCard } from "./vault";

const src = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

describe("가림막으로 연 볼트가 밑에 깔린 잠금 해제 카드를 닫는다(11-10)", () => {
  it("닫는 것은 기다리는 접속이 있고 · 처리 중이 아니고 · 볼트가 실제로 열렸을 때만", () => {
    expect(canSettleUnlockCard(1, false, "unlocked")).toBe(true);
    expect(canSettleUnlockCard(3, false, "unlocked")).toBe(true);
    // 볼트가 열리지 않았으면 카드는 그대로 — 건너뛰는 길이 되면 안 된다
    expect(canSettleUnlockCard(1, false, "locked")).toBe(false);
    expect(canSettleUnlockCard(1, false, "absent")).toBe(false);
    expect(canSettleUnlockCard(1, false, null)).toBe(false);
    // 카드가 없거나 [열기]를 처리하는 중이면 손대지 않는다
    expect(canSettleUnlockCard(0, false, "unlocked")).toBe(false);
    expect(canSettleUnlockCard(1, true, "unlocked")).toBe(false);
  });

  it("가림막이 걷히는 두 자리(이 창 · 다른 창의 걷힘)가 모두 카드 정리를 부른다", () => {
    const veil = src("./app/veil.svelte.ts");
    const close = veil.slice(veil.indexOf("export function closeVeil"), veil.indexOf("export function listenVeilAcrossWindows"));
    expect(close).toContain("settleVaultUnlockIfOpen()");
    const lifted = veil.slice(veil.indexOf("VEIL_LIFTED_EVENT, (ev)"), veil.indexOf("return Promise.all([raised, lifted])"));
    expect(lifted).toContain("settleVaultUnlockIfOpen()");
  });

  it("카드 정리는 [열기]와 같은 문(finishVaultUnlock)을 지나고 · 볼트 상태를 새로 읽어 판정한다", () => {
    const prompts = src("./app/prompts.svelte.ts");
    const fn = prompts.slice(prompts.indexOf("export async function settleVaultUnlockIfOpen"), prompts.indexOf("export function skipVaultUnlock"));
    expect(fn).toContain("vault.status(true)");
    expect(fn).toContain("canSettleUnlockCard(vuQueue.length, vu.busy, status.state)");
    expect(fn).toContain("finishVaultUnlock()");
  });
});
