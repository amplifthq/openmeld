import { describe, expect, it } from "vitest";
import {
  buildComposerActivityViewState,
  type ComposerActivitySource,
} from "../src/space/view/build-composer-activity-view-state";
import type { ComposerDispatchRowState } from "../src/space/view/space-session-view-state";

describe("buildComposerActivityViewState", () => {
  it("returns hidden idle state when no rows exist", () => {
    expect(
      buildComposerActivityViewState({
        nowMs: 5000,
        rows: [],
      })
    ).toEqual({
      visible: false,
      mode: "idle",
      rows: [],
      overflowCount: 0,
      actors: [],
      leadActor: null,
      elapsedSeconds: null,
      previewText: "",
      hint: null,
      spaceMembersSnapshot: null,
    });
  });

  it("shows sending mode from a sending row", () => {
    expect(
      buildComposerActivityViewState({
        nowMs: 5000,
        rows: [
          createDispatchRow({
            rowId: "pending:1",
            targetLabel: "",
            stage: "sending",
            createdAtMs: 4000,
            updatedAtMs: 4000,
            statusText: "Sending: @hi-agent hello there",
          }),
        ],
      })
    ).toMatchObject({
      visible: true,
      mode: "sending",
      rows: [
        {
          key: "pending:1",
          mode: "sending",
          hint: "Sending: @hi-agent hello there",
        },
      ],
      overflowCount: 0,
      actors: [],
      leadActor: null,
    });
  });

  it("keeps replying rows separate so each dispatch renders its own row", () => {
    const viewState = buildComposerActivityViewState({
      nowMs: 9500,
      rows: [
        createDispatchRow({
          rowId: "dispatch:dispatch-a",
          dispatchId: "dispatch-a",
          targetProfileId: "agt_hi",
          targetLabel: "hi-agent",
          stage: "replying",
          createdAtMs: 5000,
          updatedAtMs: 8000,
        }),
        createDispatchRow({
          rowId: "dispatch:dispatch-b",
          dispatchId: "dispatch-b",
          targetProfileId: "agt_hi",
          targetLabel: "hi-agent",
          stage: "replying",
          createdAtMs: 6000,
          updatedAtMs: 9000,
          latestPreviewText: "hello there",
          latestPreviewUpdatedAtMs: 9000,
        }),
      ],
    });

    expect(viewState.mode).toBe("streaming");
    expect(viewState.elapsedSeconds).toBe(3);
    expect(viewState.previewText).toBe("hello there");
    expect(viewState.rows).toMatchObject([
      {
        key: "dispatch:dispatch-a",
        mode: "replying",
        previewText: "",
      },
      {
        key: "dispatch:dispatch-b",
        mode: "streaming",
        previewText: "hello there",
      },
    ]);
  });

  it("keeps only the two most recent rows and renders the newest one closest to the composer", () => {
    const viewState = buildComposerActivityViewState({
      nowMs: 10_000,
      rows: [
        createDispatchRow({
          rowId: "dispatch:codex",
          dispatchId: "dispatch-codex",
          targetProfileId: "agt_codex",
          targetLabel: "hi-agent",
          stage: "replying",
          createdAtMs: 1000,
          updatedAtMs: 7000,
        }),
        createDispatchRow({
          rowId: "dispatch:claude",
          dispatchId: "dispatch-claude",
          targetProfileId: "agt_claude",
          targetLabel: "oh-my-claude",
          stage: "replying",
          createdAtMs: 2000,
          updatedAtMs: 9000,
          latestPreviewText: "Working on it",
          latestPreviewUpdatedAtMs: 9000,
        }),
        createDispatchRow({
          rowId: "dispatch:research",
          dispatchId: "dispatch-openresearch",
          targetProfileId: "agt_research",
          targetLabel: "openresearch-agent",
          stage: "replying",
          createdAtMs: 3000,
          updatedAtMs: 8500,
        }),
      ],
    });

    expect(viewState.mode).toBe("streaming");
    expect(viewState.leadActor?.label).toBe("oh-my-claude");
    expect(viewState.overflowCount).toBe(1);
    expect(viewState.rows.map((row) => row.leadActor?.label)).toEqual([
      "openresearch-agent",
      "oh-my-claude",
    ]);
  });

  it("shows sending and dispatching rows independently", () => {
    const viewState = buildComposerActivityViewState({
      nowMs: 12_000,
      rows: [
        createDispatchRow({
          rowId: "dispatch:dispatching-a",
          dispatchId: "dispatching-a",
          targetProfileId: "agt_target",
          targetLabel: "target-bot",
          stage: "dispatching",
          createdAtMs: 10_000,
          updatedAtMs: 11_500,
          statusText: "Dispatching to @target-bot...",
        }),
        createDispatchRow({
          rowId: "pending:client-1",
          sourceClientMessageId: "client-1",
          targetMentionLabel: null,
          targetLabel: "",
          stage: "sending",
          createdAtMs: 11_000,
          updatedAtMs: 11_750,
          statusText: "Sending: @target-bot hello there",
        }),
      ],
    });

    expect(viewState.mode).toBe("sending");
    expect(viewState.rows.map((row) => row.mode)).toEqual([
      "dispatching",
      "sending",
    ]);
    expect(viewState.rows[0]?.hint).toBe("Dispatching to @target-bot...");
    expect(viewState.rows[1]?.hint).toBe("Sending: @target-bot hello there");
  });

  it("shows warning and replying rows independently", () => {
    const viewState = buildComposerActivityViewState({
      nowMs: 12_000,
      rows: [
        createDispatchRow({
          rowId: "dispatch:replying",
          dispatchId: "dispatch-replying",
          targetProfileId: "agt_replying",
          targetLabel: "reply-bot",
          stage: "replying",
          createdAtMs: 8000,
          updatedAtMs: 9000,
        }),
        createDispatchRow({
          rowId: "dispatch:warning",
          dispatchId: "dispatch-warning",
          targetProfileId: "agt_warning",
          targetLabel: "warning-bot",
          stage: "warning",
          createdAtMs: 10_000,
          updatedAtMs: 11_500,
          statusText: "Couldn't route @warning-bot right now",
          warningText: "Couldn't route @warning-bot right now",
        }),
      ],
    });

    expect(viewState.mode).toBe("warning");
    expect(viewState.hint).toBe("Couldn't route @warning-bot right now");
    expect(viewState.leadActor?.label).toBe("warning-bot");
    expect(viewState.rows.map((row) => row.mode)).toEqual([
      "replying",
      "warning",
    ]);
  });
});

function createDispatchRow(
  input: Partial<ComposerDispatchRowState> & {
    rowId: string;
    targetLabel: string;
    stage: ComposerDispatchRowState["stage"];
    createdAtMs: number;
    updatedAtMs: number;
  }
): ComposerActivitySource["rows"][number] {
  return {
    rowId: input.rowId,
    dispatchId: input.dispatchId ?? null,
    sourceEventId: input.sourceEventId ?? null,
    sourceClientMessageId: input.sourceClientMessageId ?? null,
    targetProfileId: input.targetProfileId ?? null,
    targetMentionLabel: input.targetMentionLabel ?? null,
    targetLabel: input.targetLabel,
    stage: input.stage,
    createdAtMs: input.createdAtMs,
    updatedAtMs: input.updatedAtMs,
    expiresAtMs: input.expiresAtMs ?? input.updatedAtMs + 180_000,
    latestPreviewText: input.latestPreviewText ?? "",
    latestPreviewUpdatedAtMs: input.latestPreviewUpdatedAtMs ?? null,
    statusText: input.statusText ?? "",
    warningText: input.warningText ?? "",
  };
}
