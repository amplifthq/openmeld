import { describe, expect, it, vi } from "vitest";
import { readSpaceBoardExecutionProjection } from "../space/infrastructure/d1/space-board-execution-read-repo";

const RUNNING_PROFILE_ID = "agt_11111111-1111-4111-8111-111111111111";
const QUEUED_PROFILE_ID = "agt_22222222-2222-4222-8222-222222222222";
const REPLIED_PROFILE_ID = "agt_33333333-3333-4333-8333-333333333333";
const FAILED_PROFILE_ID = "agt_44444444-4444-4444-8444-444444444444";
const STOPPED_PROFILE_ID = "agt_55555555-5555-4555-8555-555555555555";
const SILENT_PROFILE_ID = "agt_66666666-6666-4666-8666-666666666666";
const UPDATED_PROFILE_ID = "agt_77777777-7777-4777-8777-777777777777";

describe("Space Board execution read projection", () => {
  it("reports only truly running executions and the latest terminal outcomes", async () => {
    const capturedQueries: string[] = [];
    const capturedBindings: unknown[][] = [];
    const db = {
      prepare: vi.fn((query: string) => {
        capturedQueries.push(query);
        const isWorkingQuery = query.includes("status = 'running'");
        return {
          bind: vi.fn((...bindings: unknown[]) => {
            capturedBindings.push(bindings);
            return {
              all: vi.fn().mockResolvedValue({
                results: isWorkingQuery
                  ? [
                      {
                        started_at_ms: Date.parse("2026-07-15T01:00:00.000Z"),
                        status: "running",
                        target_profile_id: RUNNING_PROFILE_ID,
                      },
                      {
                        started_at_ms: Date.parse("2026-07-15T01:01:00.000Z"),
                        status: "queued",
                        target_profile_id: QUEUED_PROFILE_ID,
                      },
                    ]
                  : [
                      {
                        status: "reply_published",
                        target_profile_id: REPLIED_PROFILE_ID,
                        public_outcome: "post_message",
                        terminal_outcome_json: JSON.stringify({
                          kind: "reply_published",
                          observedAtMs: Date.parse("2026-07-15T02:00:00.000Z"),
                          reasonCode: "space.reply_published",
                        }),
                        updated_at_ms: Date.parse("2026-07-15T02:00:01.000Z"),
                      },
                      {
                        status: "reply_published",
                        target_profile_id: FAILED_PROFILE_ID,
                        public_outcome: "system_notice",
                        terminal_outcome_json: JSON.stringify({
                          kind: "reply_published",
                          observedAtMs: Date.parse("2026-07-15T01:55:00.000Z"),
                          reasonCode: "space.reply_published",
                        }),
                        updated_at_ms: Date.parse("2026-07-15T01:55:01.000Z"),
                      },
                      {
                        status: "reply_published",
                        target_profile_id: SILENT_PROFILE_ID,
                        public_outcome: "stay_silent",
                        terminal_outcome_json: JSON.stringify({
                          kind: "reply_published",
                          observedAtMs: Date.parse("2026-07-15T01:50:00.000Z"),
                          reasonCode: "space.reply_published",
                        }),
                        updated_at_ms: Date.parse("2026-07-15T01:50:01.000Z"),
                      },
                      {
                        status: "reply_published",
                        target_profile_id: UPDATED_PROFILE_ID,
                        public_outcome: "post_status",
                        terminal_outcome_json: JSON.stringify({
                          kind: "reply_published",
                          observedAtMs: Date.parse("2026-07-15T01:48:00.000Z"),
                          reasonCode: "space.reply_published",
                        }),
                        updated_at_ms: Date.parse("2026-07-15T01:48:01.000Z"),
                      },
                      {
                        status: "failed_terminal",
                        target_profile_id: FAILED_PROFILE_ID,
                        public_outcome: null,
                        terminal_outcome_json: JSON.stringify({
                          kind: "timed_out",
                          observedAtMs: Date.parse("2026-07-15T01:45:00.000Z"),
                          reasonCode: "runtime.progress_stale",
                        }),
                        updated_at_ms: Date.parse("2026-07-15T01:45:01.000Z"),
                      },
                      {
                        status: "cancelled",
                        target_profile_id: STOPPED_PROFILE_ID,
                        public_outcome: null,
                        terminal_outcome_json: JSON.stringify({
                          kind: "cancelled",
                          observedAtMs: Date.parse("2026-07-15T01:30:00.000Z"),
                          reasonCode: "wake_stopped",
                        }),
                        updated_at_ms: Date.parse("2026-07-15T01:30:01.000Z"),
                      },
                      {
                        status: "delivery_pending",
                        target_profile_id: QUEUED_PROFILE_ID,
                        public_outcome: null,
                        terminal_outcome_json: null,
                        updated_at_ms: Date.parse("2026-07-15T02:05:00.000Z"),
                      },
                    ],
              }),
            };
          }),
        };
      }),
    } as unknown as D1Database;

    await expect(
      readSpaceBoardExecutionProjection({ db, spaceId: "space-board-1" })
    ).resolves.toEqual({
      workingNow: [
        {
          profileId: RUNNING_PROFILE_ID,
          startedAt: "2026-07-15T01:00:00.000Z",
        },
      ],
      recentOutcomes: [
        {
          at: "2026-07-15T02:00:00.000Z",
          outcome: "replied",
          profileId: REPLIED_PROFILE_ID,
        },
        {
          at: "2026-07-15T01:55:00.000Z",
          outcome: "failed",
          profileId: FAILED_PROFILE_ID,
        },
        {
          at: "2026-07-15T01:45:00.000Z",
          outcome: "timed_out",
          profileId: FAILED_PROFILE_ID,
        },
        {
          at: "2026-07-15T01:30:00.000Z",
          outcome: "stopped",
          profileId: STOPPED_PROFILE_ID,
        },
      ],
    });

    expect(capturedQueries[0]).toContain("execution.status = 'running'");
    expect(capturedQueries[0]).toContain("event_type = 'lifecycle_running'");
    expect(capturedQueries[1]).toContain(
      "status IN ('reply_published', 'failed_terminal', 'cancelled')"
    );
    expect(capturedQueries[1]).toContain(
      "LEFT JOIN openMeldDaemon_dispatch_results"
    );
    expect(capturedQueries[1]).toContain(
      "result.public_outcome IN ('post_message', 'raw_context_sharing', 'system_notice')"
    );
    expect(capturedBindings).toEqual([
      ["space-board-1"],
      ["space-board-1", 10],
    ]);
  });

  it("returns empty arrays when the Space has no execution history", async () => {
    const db = {
      prepare: vi.fn(() => ({
        bind: vi.fn(() => ({
          all: vi.fn().mockResolvedValue({ results: [] }),
        })),
      })),
    } as unknown as D1Database;

    await expect(
      readSpaceBoardExecutionProjection({ db, spaceId: "empty-space" })
    ).resolves.toEqual({ workingNow: [], recentOutcomes: [] });
  });
});
