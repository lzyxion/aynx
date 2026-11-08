import { describe, expect, it } from "vitest";
import { riseDelay } from "./dashboard-motion";

describe("riseDelay", () => {
  it("120ms 에서 56ms 씩 늘고 여섯째(순번 5)에서 멈춘다", () => {
    expect([0, 1, 2, 5, 6, 9].map(riseDelay)).toEqual([120, 176, 232, 400, 400, 400]);
  });
});
