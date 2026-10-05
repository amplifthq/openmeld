import type { PostgresDatabase, QueryConfig } from "@openmeld/db/postgresql";
import { expect, it } from "vitest";
import { registerAgentTaskCompletionSubscription } from "../src/agent-task-coordination/infrastructure/postgresql/agent-task-coordination-repo";
import { upsertRemoteAgentNativeDeliveryRecord } from "../src/remote-agent/infrastructure/postgresql/native-delivery-ledger-repo";
import { readSpaceDeletionPendingWork } from "../src/space/application/space-deletion-work";
import { createPostgresHarness } from "./helpers/postgresql-harness.test-support";

it("keeps deletion blocked when a continuation becomes a delivery between reads", async () => {
  const harness = await createPostgresHarness();
  let releaseNativeRead: () => void = () => undefined;
  const nativeRead = new Promise<void>((resolve) => {
    releaseNativeRead = resolve;
  });
  let releaseHandoff: () => void = () => undefined;
  const handoff = new Promise<void>((resolve) => {
    releaseHandoff = resolve;
  });
  let pendingRead: ReturnType<typeof readSpaceDeletionPendingWork> | undefined;
  try {
    const delivery = {
      db: harness.db,
      nowMs: 1000,
      organizationId: "org-deletion-race",
      spaceId: "space-deletion-race",
      profileId: "agt_11111111-1111-4111-8111-111111111111",
      bindingId: "binding-deletion-race",
      triggerMessageId: "trigger-deletion-race",
      attemptId: null,
    };
    await upsertRemoteAgentNativeDeliveryRecord({
      ...delivery,
      deliveryId: "observer-deletion-race",
      dispatchId: "observer-dispatch",
      idempotencyKey: "observer-key",
      status: "completed",
    });
    await registerAgentTaskCompletionSubscription({
      db: harness.db,
      nowMs: 1000,
      organizationId: delivery.organizationId,
      subscriptionId: "subscription-deletion-race",
      idempotencyKey: "subscription-key",
      completionCondition: "terminal",
      observerTask: {
        v: 1,
        kind: "native_delivery",
        deliveryId: "observer-deletion-race",
      },
      watchedTask: {
        v: 1,
        kind: "native_delivery",
        deliveryId: "child-deletion-race",
      },
      continuation: {
        kind: "resume_agent",
        delegationId: "delegation-deletion-race",
        instruction: "Summarize the result.",
      },
    });
    // Keep real PostgreSQL queries and results. Pause only the late read so
    // another connection can complete the handoff after the delivery read.
    const observedDb: Pick<PostgresDatabase, "transaction"> = {
      transaction: (callback) =>
        harness.db.transaction((client) =>
          callback(
            new Proxy(client, {
              get(target, property) {
                if (property === "query") {
                  return async (
                    query: string | QueryConfig,
                    values?: unknown[]
                  ) => {
                    const sql = typeof query === "string" ? query : query.text;
                    if (
                      sql.includes(
                        'FROM "openmeld"."agent_task_completion_subscriptions"'
                      )
                    ) {
                      await handoff;
                    }
                    const result = await target.query(query, values);
                    if (
                      sql.includes(
                        'SELECT 1 FROM "openmeld"."openMeldRemoteAgent_native_delivery_ledger"'
                      )
                    ) {
                      releaseNativeRead();
                    }
                    return result;
                  };
                }
                const value = Reflect.get(target, property);
                return typeof value === "function" ? value.bind(target) : value;
              },
            })
          )
        ),
    };
    pendingRead = readSpaceDeletionPendingWork({
      db: observedDb,
      spaceId: delivery.spaceId,
    });
    await nativeRead;
    await upsertRemoteAgentNativeDeliveryRecord({
      ...delivery,
      deliveryId: "continuation-deletion-race",
      dispatchId: "continuation-dispatch",
      idempotencyKey: "continuation-key",
      status: "submitted",
    });
    await harness.query({
      text: 'UPDATE "openmeld"."agent_task_completion_subscriptions" SET state = $1 WHERE subscription_id = $2',
      values: ["settled", "subscription-deletion-race"],
    });
    releaseHandoff();
    expect(await pendingRead).toMatchObject({
      nativeDelivery: false,
      continuation: true,
    });
    expect(
      await readSpaceDeletionPendingWork({
        db: harness.db,
        spaceId: delivery.spaceId,
      })
    ).toMatchObject({ nativeDelivery: true, continuation: false });
  } finally {
    releaseHandoff();
    await pendingRead;
    await harness.close();
  }
});
