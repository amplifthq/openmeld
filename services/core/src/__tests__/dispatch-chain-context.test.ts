import { describe, expect, it } from "vitest";
import {
  buildVisitedProfileIdsHash,
  createDispatchChainContext,
  createNextDispatchChainContext,
} from "../dispatch/rules/dispatch-chain-context";

describe("dispatch chain context", () => {
  it("builds root chain context with zero relay depth", () => {
    const context = createDispatchChainContext({
      dispatchId: "dispatch-1",
    });

    expect(context.dispatchChainId).toBe("dispatch-1");
    expect(context.autoRelayDepth).toBe(0);
    expect(context.visitedProfileIds).toEqual([]);
    expect(context.visitedProfileIdsHash).toBe(buildVisitedProfileIdsHash([]));
  });

  it("produces stable hash regardless of input order", () => {
    const hashA = buildVisitedProfileIdsHash(["agt-c", "agt-a", "agt-b"]);
    const hashB = buildVisitedProfileIdsHash(["agt-b", "agt-c", "agt-a"]);
    expect(hashA).toBe(hashB);
  });

  it("increments relay depth while preserving chain id", () => {
    const next = createNextDispatchChainContext({
      dispatchChainId: "chain-1",
      autoRelayDepth: 2,
      sourceVisitedProfileIds: ["agt-1", "agt-2"],
      senderProfileId: "agt-2",
    });
    expect(next.dispatchChainId).toBe("chain-1");
    expect(next.autoRelayDepth).toBe(3);
    expect(next.visitedProfileIds).toEqual(["agt-1", "agt-2"]);
    expect(next.visitedProfileIdsHash.startsWith("stable32:")).toBe(true);
  });
});
