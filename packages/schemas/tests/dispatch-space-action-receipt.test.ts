import { describe, expect, it } from "vitest";
import { dispatchSpaceActionToolResultSchema } from "../src/schemas/space-mesh/dispatch-space-action-receipt";

const localReceipt = {
  status: "proposal_saved_locally",
  actionType: "post_message",
  attemptId: "attempt-1",
  contextId: "context-1",
  dispatchId: "dispatch-1",
  recordedAtMs: 1000,
  contextState: "expired",
  coordinatorAcceptance: "unconfirmed",
  publication: "unconfirmed",
} as const;

describe("dispatch Space Action receipts", () => {
  it.each([
    { publication: "published" },
    { coordinatorAcceptance: "accepted" },
    { nonce: "must-not-leave-the-local-record" },
    { recordedAtMs: -1 },
  ])("rejects unproven remote facts or invalid local evidence: %j", (change) => {
    expect(
      dispatchSpaceActionToolResultSchema.safeParse({
        receipt: { ...localReceipt, ...change },
      }).success
    ).toBe(false);
  });

  it("retains the historical identity after local expiry without implying publication", () => {
    expect(
      dispatchSpaceActionToolResultSchema.parse({ receipt: localReceipt })
    ).toEqual({ receipt: localReceipt });
  });
});
