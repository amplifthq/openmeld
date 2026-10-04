import { connectorActionOutcomeUnknownSchema } from "@openmeld/schemas";
import { describe, expect, it } from "vitest";

describe("uncertain connector receipt compatibility", () => {
  const receipt = {
    status: "outcome_unknown",
    actionId: "fixture.create_note",
    operationId: "original-operation",
    executionConfirmation: "unknown",
    providerExecutionId: null,
    message: "The write may have succeeded.",
  };

  it("keeps older receipts valid without inventing replay permission", () => {
    expect(
      connectorActionOutcomeUnknownSchema.parse(receipt).replay
    ).toBeUndefined();
  });

  it("rejects unlimited or expired replay permission", () => {
    for (const replay of [
      { allowed: true, remainingWindowMs: 0, maxAttempts: 1 },
      { allowed: true, remainingWindowMs: 60_000, maxAttempts: 2 },
      { allowed: false },
    ]) {
      expect(
        connectorActionOutcomeUnknownSchema.safeParse({ ...receipt, replay })
          .success
      ).toBe(false);
    }
  });
});
