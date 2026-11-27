import { describe, expect, it } from "vitest";
import {
  toSendableCloseCode,
  toSendableCloseReason,
} from "../src/lib/websocket-upgrade-relay";

describe("websocket upgrade relay close frames", () => {
  it("keeps codes that a Close frame may carry", () => {
    expect(toSendableCloseCode(1000)).toBe(1000);
    expect(toSendableCloseCode(1012)).toBe(1012);
    expect(toSendableCloseCode(4401)).toBe(4401);
  });

  it("maps codes that only a close event can report to 1011", () => {
    for (const code of [1004, 1005, 1006, 1015, 0, 999, 5000, Number.NaN]) {
      expect(toSendableCloseCode(code)).toBe(1011);
    }
  });

  it("truncates a reason to 123 bytes without splitting a character", () => {
    expect(toSendableCloseReason("upstream_closed")).toBe("upstream_closed");
    const truncated = toSendableCloseReason("连".repeat(60));
    expect(truncated).toBe("连".repeat(41));
    expect(new TextEncoder().encode(truncated).byteLength).toBe(123);
  });
});
