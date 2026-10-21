import { getPostgresDatabase } from "@openmeld/db/postgresql";
import { describe, expect, it } from "vitest";
import {
  claimDispatchAttempt,
  claimFinalReplyEmission,
} from "../src/dispatch/infrastructure/postgresql/dispatch-ledger-postgresql";
import { env } from "../test-support/worker-env";
import { buildDispatchMessage } from "../tests-support/dispatch-ledger-message";
import { installWorkerPostgresWriteFailure } from "./postgresql.test-support";

describe("dispatch ledger on PostgreSQL", () => {
  it("persists intake identity and claims one final reply for the same Wake", async () => {
    const id = crypto.randomUUID();
    const message = buildDispatchMessage({
      dispatchId: id,
      idempotencyKey: id,
      sourceEventId: `source-${id}`,
      sourceClientMessageId: `client-${id}`,
      sourceProfileId: `human-${id}`,
      dispatchOwner: { kind: "owner_account", id: `owner-${id}` },
    });
    const input = {
      db: getPostgresDatabase(env),
      message,
      attempt: 1,
      nowMs: 1000,
    };
    const first = await claimDispatchAttempt(input);
    expect(first).toMatchObject({ status: "claimed", attemptNo: 1 });
    await expect(claimDispatchAttempt(input)).resolves.toMatchObject({
      status: "deduped",
      admissionInFlight: true,
    });
    const row = await getPostgresDatabase(env)
      .query({
        ...{
          text: `
      SELECT source_profile_id, source_client_message_id,
        dispatch_owner_kind, dispatch_owner_id, attempt_count, status
      FROM "openmeld"."openMeldDaemon_dispatch_ledger" WHERE idempotency_key = $1
    `,
          values: [],
        },
        values: [id],
      })
      .then((result) => result.rows[0] ?? null);
    expect(row).toEqual({
      source_profile_id: `human-${id}`,
      source_client_message_id: `client-${id}`,
      dispatch_owner_kind: "owner_account",
      dispatch_owner_id: `owner-${id}`,
      attempt_count: 1,
      status: "queued",
    });
    const reply = {
      db: getPostgresDatabase(env),
      idempotencyKey: id,
      nowMs: 1100,
    };
    await expect(claimFinalReplyEmission(reply)).resolves.toBe("claimed");
    await expect(claimFinalReplyEmission(reply)).resolves.toBe(
      "already_claimed"
    );
  });
  it("rolls back intake on an attempt insert failure and allows the same Wake to retry", async () => {
    const id = crypto.randomUUID();
    const message = buildDispatchMessage({
      dispatchId: id,
      idempotencyKey: id,
    });
    const input = {
      db: getPostgresDatabase(env),
      message,
      attempt: 1,
      nowMs: 1000,
    };
    const removeFailure = await installWorkerPostgresWriteFailure({
      env: env as unknown as Parameters<
        typeof installWorkerPostgresWriteFailure
      >[0]["env"],
      table: "openMeldDaemon_dispatch_attempts",
      operation: "INSERT",
      condition: `NEW.dispatch_id = '${id}'`,
      message: "injected dispatch attempt insert failure",
    });
    try {
      await expect(claimDispatchAttempt(input)).rejects.toThrow(
        "injected dispatch attempt insert failure"
      );
      await expect(
        getPostgresDatabase(env)
          .query({
            ...{
              text: `
        SELECT dispatch_id FROM "openmeld"."openMeldDaemon_dispatch_ledger" WHERE idempotency_key = $1
      `,
              values: [],
            },
            values: [id],
          })
          .then((result) => result.rows[0] ?? null)
      ).resolves.toBeNull();
    } finally {
      await removeFailure();
    }
    await expect(claimDispatchAttempt(input)).resolves.toMatchObject({
      status: "claimed",
      attemptNo: 1,
    });
  });
});
