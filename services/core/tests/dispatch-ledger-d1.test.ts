import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import {
  claimDispatchAttempt,
  claimFinalReplyEmission,
} from "../src/dispatch/infrastructure/d1/dispatch-ledger-d1";
import { buildDispatchMessage } from "../tests-support/dispatch-ledger-message";

describe("dispatch ledger on Cloudflare D1", () => {
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
    const input = { db: env.OPENMELD_DB, message, attempt: 1, nowMs: 1000 };
    const first = await claimDispatchAttempt(input);
    expect(first).toMatchObject({ status: "claimed", attemptNo: 1 });
    await expect(claimDispatchAttempt(input)).resolves.toMatchObject({
      status: "deduped",
      admissionInFlight: true,
    });
    const row = await env.OPENMELD_DB.prepare(`
      SELECT source_profile_id, source_client_message_id,
        dispatch_owner_kind, dispatch_owner_id, attempt_count, status
      FROM openMeldDaemon_dispatch_ledger WHERE idempotency_key = ?
    `)
      .bind(id)
      .first();
    expect(row).toEqual({
      source_profile_id: `human-${id}`,
      source_client_message_id: `client-${id}`,
      dispatch_owner_kind: "owner_account",
      dispatch_owner_id: `owner-${id}`,
      attempt_count: 1,
      status: "queued",
    });
    const reply = { db: env.OPENMELD_DB, idempotencyKey: id, nowMs: 1100 };
    await expect(claimFinalReplyEmission(reply)).resolves.toBe("claimed");
    await expect(claimFinalReplyEmission(reply)).resolves.toBe(
      "already_claimed"
    );
  });

  it("rolls back intake on an attempt insert failure and allows the same Wake to retry", async () => {
    const id = crypto.randomUUID();
    const trigger = `fail_dispatch_attempt_${id.replaceAll("-", "")}`;
    const message = buildDispatchMessage({
      dispatchId: id,
      idempotencyKey: id,
    });
    const input = { db: env.OPENMELD_DB, message, attempt: 1, nowMs: 1000 };
    // Scope the real SQLite failure to this fixture; other tests share D1.
    await env.OPENMELD_DB.prepare(`
      CREATE TRIGGER ${trigger} BEFORE INSERT ON openMeldDaemon_dispatch_attempts
      WHEN NEW.dispatch_id = '${id}'
      BEGIN SELECT RAISE(ABORT, 'injected dispatch attempt insert failure'); END
    `).run();
    try {
      await expect(claimDispatchAttempt(input)).rejects.toThrow(
        "injected dispatch attempt insert failure"
      );
      await expect(
        env.OPENMELD_DB.prepare(`
        SELECT dispatch_id FROM openMeldDaemon_dispatch_ledger WHERE idempotency_key = ?
      `)
          .bind(id)
          .first()
      ).resolves.toBeNull();
    } finally {
      await env.OPENMELD_DB.prepare(`DROP TRIGGER ${trigger}`).run();
    }
    await expect(claimDispatchAttempt(input)).resolves.toMatchObject({
      status: "claimed",
      attemptNo: 1,
    });
  });
});
