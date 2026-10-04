import type { PostgresDatabase } from "@openmeld/db/postgresql";
import { afterEach, describe, expect, it } from "vitest";
import {
  beginCenterAgentPublicationOperation,
  buildCenterAgentPublicationRequestSignature,
  CENTER_AGENT_PUBLICATION_DEFAULT_OPERATION_KEY,
  completeCenterAgentPublicationOperation,
  failCenterAgentPublicationOperation,
} from "../src/center-agent/center-agent-publication-operation-repository";
import { createPostgresHarness } from "./helpers/postgresql-harness.test-support";

describe("Center Agent publication operation repository", () => {
  let harness: Awaited<ReturnType<typeof createPostgresHarness>> | null = null;

  afterEach(async () => {
    await harness?.close();
    harness = null;
  });

  it("replays one completed source publication without a second claim", async () => {
    harness = await createHarness();
    const input = await publicationInput(harness.db);
    const first = await beginCenterAgentPublicationOperation(input);

    expect(first).toMatchObject({
      operation: { claimId: expect.any(String), status: "pending" },
      outcome: "claimed",
    });
    const claimId = requireClaimId(first.operation.claimId);

    await completeCenterAgentPublicationOperation({
      claimId,
      db: harness.db,
      nowMs: 1002,
      operationId: first.operation.id,
      responseJson: JSON.stringify({ messageTs: "1710000000.001" }),
    });

    await expect(
      beginCenterAgentPublicationOperation({
        ...input,
        nowMs: 1003,
      })
    ).resolves.toMatchObject({
      outcome: "completed_replay",
      operation: {
        claimId: null,
        id: first.operation.id,
        responseJson: '{"messageTs":"1710000000.001"}',
        status: "completed",
      },
    });
  });

  it("rejects changed content or represented identity for the same source publication", async () => {
    harness = await createHarness();
    const input = await publicationInput(harness.db);
    await beginCenterAgentPublicationOperation(input);

    await expect(
      beginCenterAgentPublicationOperation({
        ...input,
        requestSignature: await buildCenterAgentPublicationRequestSignature({
          representedUserId: "user-a",
          text: "A different message.",
        }),
      })
    ).rejects.toMatchObject({
      code: "center_agent.publication_conflict",
      status: 409,
    });

    await expect(
      beginCenterAgentPublicationOperation({
        ...input,
        representedUserId: "user-b",
      })
    ).rejects.toMatchObject({
      code: "center_agent.publication_conflict",
      status: 409,
    });
  });

  it("reclaims a confirmed non-publication and fences the stale claimant", async () => {
    harness = await createHarness();
    const input = await publicationInput(harness.db);
    const first = await beginCenterAgentPublicationOperation(input);
    const firstClaimId = requireClaimId(first.operation.claimId);

    await failCenterAgentPublicationOperation({
      claimId: firstClaimId,
      db: harness.db,
      nowMs: 1002,
      operationId: first.operation.id,
      outcome: "failed",
    });

    const retry = await beginCenterAgentPublicationOperation({
      ...input,
      nowMs: 1003,
    });
    const retryClaimId = requireClaimId(retry.operation.claimId);

    expect(retry).toMatchObject({
      operation: { id: first.operation.id, status: "pending" },
      outcome: "claimed",
    });
    expect(retryClaimId).not.toBe(firstClaimId);
    await expect(
      completeCenterAgentPublicationOperation({
        claimId: firstClaimId,
        db: harness.db,
        nowMs: 1004,
        operationId: first.operation.id,
        responseJson: "{}",
      })
    ).rejects.toThrow("current claim");
  });

  it("claims more than one Slack file from the same execution", async () => {
    harness = await createHarness();
    const input = await publicationInput(harness.db);

    await expect(
      beginCenterAgentPublicationOperation({
        ...input,
        destinationId: `D_CURRENT_THREAD:1710000000.001:${"b".repeat(64)}`,
        destinationKind: "slack_file",
      })
    ).resolves.toMatchObject({ outcome: "claimed" });

    await expect(
      beginCenterAgentPublicationOperation({
        ...input,
        destinationId: `D_CURRENT_THREAD:1710000000.001:${"c".repeat(64)}`,
        destinationKind: "slack_file",
      })
    ).resolves.toMatchObject({ outcome: "claimed" });
  });

  it("keeps an active claim in progress and closes an expired claim as outcome unknown", async () => {
    harness = await createHarness();
    const input = await publicationInput(harness.db);
    const first = await beginCenterAgentPublicationOperation(input);

    await expect(
      beginCenterAgentPublicationOperation({
        ...input,
        nowMs: first.operation.claimExpiresAtMs as number,
      })
    ).resolves.toMatchObject({
      operation: { claimId: null, status: "outcome_unknown" },
      outcome: "outcome_unknown",
    });

    await expect(
      beginCenterAgentPublicationOperation({
        ...input,
        nowMs: (first.operation.claimExpiresAtMs as number) + 1,
      })
    ).resolves.toMatchObject({
      operation: { claimId: null, status: "outcome_unknown" },
      outcome: "outcome_unknown",
    });
  });

  it("reports an unexpired concurrent claim without changing it", async () => {
    harness = await createHarness();
    const input = await publicationInput(harness.db);
    const first = await beginCenterAgentPublicationOperation(input);

    await expect(
      beginCenterAgentPublicationOperation({
        ...input,
        nowMs: 1002,
      })
    ).resolves.toMatchObject({
      operation: {
        claimId: first.operation.claimId,
        status: "pending",
      },
      outcome: "pending_in_progress",
    });
  });
});

async function createHarness(): Promise<
  Awaited<ReturnType<typeof createPostgresHarness>>
> {
  const created = await createPostgresHarness();
  for (const sql of [
    "INSERT INTO \"openmeld\".\"users\" (id, \"name\", \"email\") VALUES ('user-a', 'Test User', ('user-a')::text || '@example.com'),\n('user-b', 'Test User', ('user-b')::text || '@example.com')",
    'INSERT INTO "openmeld"."organizations" (id, "name", "slug", "created_at") VALUES (\'org-a\', \'Test Organization\', (\'org-a\')::text, 1700000000000)',
    `INSERT INTO "openmeld"."openmeld_profiles" (profile_id, profile_name, profile_handle, profile_kind, organization_id, owner_user_id, created_by_user_id, managed_role, source, status) VALUES ('agt_11111111-1111-4111-8111-111111111111', 'Center Agent', 'center-agent', 'agent', 'org-a', NULL, 'user-a', 'center_agent', 'auth_bootstrap', 'active')`,
  ]) {
    await created.query({ text: sql });
  }

  return created;
}

async function publicationInput(db: PostgresDatabase) {
  return {
    db,
    destinationId: "C_RELEASE",
    destinationKind: "slack_channel" as const,
    nowMs: 1001,
    operationKey: CENTER_AGENT_PUBLICATION_DEFAULT_OPERATION_KEY,
    representedUserId: "user-a",
    requestSignature: await buildCenterAgentPublicationRequestSignature({
      representedUserId: "user-a",
      text: "The release is ready.",
    }),
    source: {
      kind: "organization_document" as const,
      sourceId: "document-daily-journal",
      sourceRevision: "a".repeat(64),
    },
    actorProfileId: "agt_11111111-1111-4111-8111-111111111111",
    organizationId: "org-a",
  };
}

function requireClaimId(claimId: string | null): string {
  if (!claimId) {
    throw new Error("Expected a publication claim id.");
  }
  return claimId;
}
