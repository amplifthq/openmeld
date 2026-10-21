import { getPostgresDatabase } from "@openmeld/db/postgresql";
import { describe, expect, it } from "vitest";
import { updateDispatchResultInboxPublishState } from "../src/runtime-transport/infrastructure/postgresql/dispatch-result-inbox-repo";
import { env } from "../test-support/worker-env";

describe("dispatch result inbox repo", () => {
  it("keeps a published reply terminal when a later publication failure arrives", async () => {
    const db = getPostgresDatabase(env);
    const dispatchId = crypto.randomUUID();
    const resultKey = `${dispatchId}::attempt-1`;
    await db.query({
      text: `INSERT INTO "openmeld"."openMeldDaemon_dispatch_result_inbox" (
        result_key, dispatch_id, attempt_id, task_id, target_profile_id,
        daemon_session_id, lease_epoch, submitted_connection_generation,
        result_payload_json, accepted_at_ms, publish_state, published_signal_id,
        updated_at_ms
      ) VALUES ($1, $2, 'attempt-1', 'task-1', 'profile-1', 'session-1', 1, 1,
        '{}', 1700000000000, 'reply_published', 'signal-published', 1700000000000)`,
      values: [resultKey, dispatchId],
    });
    try {
      await expect(
        updateDispatchResultInboxPublishState(db, {
          attemptId: "attempt-1",
          dispatchId,
          publicationErrorCode: "space.reply_write_failed",
          publishedSignalId: null,
          publishState: "reply_publication_failed",
          updatedAtMs: 1_700_000_000_100,
        })
      ).resolves.toEqual({ status: "unchanged_terminal" });
      const persisted = await db.query({
        text: `SELECT publish_state, published_signal_id, publication_error_code,
          updated_at_ms FROM "openmeld"."openMeldDaemon_dispatch_result_inbox"
          WHERE result_key = $1`,
        values: [resultKey],
      });
      expect(persisted.rows).toEqual([
        {
          publish_state: "reply_published",
          published_signal_id: "signal-published",
          publication_error_code: null,
          updated_at_ms: 1_700_000_000_000,
        },
      ]);
    } finally {
      await db.query({
        text: 'DELETE FROM "openmeld"."openMeldDaemon_dispatch_result_inbox" WHERE result_key = $1',
        values: [resultKey],
      });
    }
  });
});
