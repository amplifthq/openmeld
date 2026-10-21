import { getPostgresDatabase } from "@openmeld/db/postgresql";
import type { DispatchResult } from "@openmeld/schemas/types";
import { beforeEach, describe, expect, it } from "vitest";
import { env } from "../test-support/worker-env";
import { postgresFixtureOperator } from "./postgresql.test-support";

beforeEach(async () => {
  await getPostgresDatabase(env).query(
    'DELETE FROM "openmeld"."openMeldDaemon_dispatch_results"'
  );
});

import { getSpaceDispatchResult } from "../src/dispatch/application/dispatch-result-read-service";
import {
  readDispatchResultByDispatchId,
  readDispatchResultByResultRef,
  upsertDispatchResult,
} from "../src/dispatch/infrastructure/postgresql/dispatch-result-repo";

describe("dispatch-result-repo", () => {
  it("fails fast when the PostgreSQL dispatch result table is unavailable", async () => {
    const db = getPostgresDatabase(env);
    const operator = postgresFixtureOperator(env);
    await operator.query(
      'ALTER TABLE "openmeld"."openMeldDaemon_dispatch_results" RENAME TO "test_dispatch_results_offline"'
    );
    try {
      await expect(
        upsertDispatchResult(db, {
          resultRef: "result-missing-schema",
          dispatchId: "dispatch-missing-schema",
          spaceId: "space-missing-schema",
          actorProfileId: "agt_33333333-3333-4333-8333-333333333333",
          actorName: "agent",
          replyToSignalId: "evt-missing-schema",
          resultKind: "text",
          finalText: "hello",
          messageEnvelope: {
            activationTargets: [],
            referenceTargets: [],
            replyToSignalId: "evt-missing-schema",
            text: "hello",
          },
          previewText: "hello",
          publicOutcome: "post_message",
          publishedSignalId: "evt-status-missing-schema",
          createdAt: "2026-03-19T00:00:00.000Z",
        })
      ).rejects.toThrow(
        'relation "openmeld.openMeldDaemon_dispatch_results" does not exist'
      );
    } finally {
      await operator.query(
        'ALTER TABLE "openmeld"."test_dispatch_results_offline" RENAME TO "openMeldDaemon_dispatch_results"'
      );
    }
  });

  it("writes and reads a dispatch result by resultRef and dispatchId", async () => {
    const db = getPostgresDatabase(env);
    const result: DispatchResult = {
      resultRef: "result-1",
      dispatchId: "dispatch-1",
      spaceId: "space-1",
      actorProfileId: "agt_33333333-3333-4333-8333-333333333333",
      actorName: "hi-agent",
      replyToSignalId: "evt-1",
      resultKind: "text",
      finalText: "The poem is ready.",
      messageEnvelope: {
        activationTargets: [],
        referenceTargets: [],
        replyToSignalId: "evt-1",
        text: "The poem is ready.",
      },
      previewText: "The poem is ready.",
      publicOutcome: "post_message",
      publishedSignalId: "evt-status-1",
      createdAt: "2026-03-19T00:00:00.000Z",
    };

    await upsertDispatchResult(db, result);

    await expect(
      readDispatchResultByResultRef(db, "result-1")
    ).resolves.toEqual(result);
    await expect(
      readDispatchResultByDispatchId(db, "dispatch-1")
    ).resolves.toEqual(result);
  });

  it("rejects invalid dispatch results before writing", async () => {
    const db = getPostgresDatabase(env);

    await expect(
      upsertDispatchResult(db, {
        resultRef: "result-2",
        dispatchId: "dispatch-2",
        spaceId: "space-1",
        actorProfileId: "agt_33333333-3333-4333-8333-333333333333",
        resultKind: "text",
        publicOutcome: "stay_silent",
        createdAt: "2026-03-19T00:00:00.000Z",
      } as DispatchResult)
    ).rejects.toThrow("dispatch result is invalid");
  });

  it("reads dispatch results only within the requested space", async () => {
    const db = getPostgresDatabase(env);
    const result: DispatchResult = {
      resultRef: "dispatch-result:result-2",
      dispatchId: "dispatch-2",
      spaceId: "space-2",
      actorProfileId: "agt_33333333-3333-4333-8333-333333333333",
      actorName: "status-agent",
      resultKind: "status",
      statusType: "done",
      previewText: "Done.",
      publicOutcome: "post_status",
      createdAt: "2026-03-21T00:00:00.000Z",
    };

    await upsertDispatchResult(db, result);

    await expect(
      getSpaceDispatchResult({
        db,
        spaceId: "space-2",
        dispatchId: "dispatch-2",
      })
    ).resolves.toEqual(result);
    await expect(
      getSpaceDispatchResult({
        db,
        spaceId: "space-2",
        resultRef: "dispatch-result:result-2",
      })
    ).resolves.toEqual(result);
    await expect(
      getSpaceDispatchResult({
        db,
        spaceId: "other-space",
        dispatchId: "dispatch-2",
      })
    ).resolves.toBeNull();
  });
});
