import { describe, expect, it } from "vitest";
import { confirmPendingOutboundRowsForSignal } from "../src/space/pending-outbound-confirmation";
import type { ComposerDispatchRowState } from "../src/space/view/space-session-view-state";

describe("pending outbound confirmation", () => {
  it("clears a generic pending row from a self echo when clientMessageId is absent", () => {
    const rowsById = new Map<string, ComposerDispatchRowState>([
      [
        "pending:client-a",
        buildPendingRow({
          rowId: "pending:client-a",
          sourceClientMessageId: "client-a",
          sourceTextSnapshot: "hello there",
          createdAtMs: 10,
        }),
      ],
    ]);

    const changed = confirmPendingOutboundRowsForSignal({
      rowsById,
      event: createSelfTextSignal({
        id: "signal-1",
        text: "hello   there",
      }),
      selfProfileId: "self-profile",
    });

    expect(changed).toBe(true);
    expect(rowsById.size).toBe(0);
  });

  it("clears only the oldest matching pending message when two queued texts normalize the same", () => {
    const rowsById = new Map<string, ComposerDispatchRowState>([
      [
        "pending:client-a",
        buildPendingRow({
          rowId: "pending:client-a",
          sourceClientMessageId: "client-a",
          sourceTextSnapshot: "@codex hello there",
          createdAtMs: 10,
        }),
      ],
      [
        "pending:client-b",
        buildPendingRow({
          rowId: "pending:client-b",
          sourceClientMessageId: "client-b",
          sourceTextSnapshot: "@codex hello there",
          createdAtMs: 30,
        }),
      ],
    ]);

    const changed = confirmPendingOutboundRowsForSignal({
      rowsById,
      event: createSelfTextSignal({
        id: "signal-1",
        text: "@codex  hello   there",
      }),
      selfProfileId: "self-profile",
    });

    expect(changed).toBe(true);
    expect(rowsById.has("pending:client-a")).toBe(false);
    expect(rowsById.has("pending:client-b")).toBe(true);
  });
});

function buildPendingRow(input: {
  rowId: string;
  sourceClientMessageId: string;
  sourceTextSnapshot: string;
  createdAtMs: number;
}): ComposerDispatchRowState {
  return {
    rowId: input.rowId,
    dispatchId: null,
    sourceEventId: null,
    sourceClientMessageId: input.sourceClientMessageId,
    sourceTextSnapshot: input.sourceTextSnapshot,
    targetProfileId: null,
    targetMentionLabel: null,
    targetLabel: "",
    stage: "sending",
    createdAtMs: input.createdAtMs,
    updatedAtMs: input.createdAtMs,
    expiresAtMs: null,
    latestPreviewText: "",
    latestPreviewUpdatedAtMs: null,
    statusText: "Sending...",
    warningText: "",
  };
}

function createSelfTextSignal(input: { id: string; text: string }) {
  return {
    v: 1 as const,
    id: input.id,
    spaceId: "ops-room",
    ts: 1,
    profile: {
      kind: "human" as const,
      profileId: "self-profile",
      profileName: "Felix",
    },
    type: "signal.text" as const,
    data: {
      text: input.text,
    },
  };
}
