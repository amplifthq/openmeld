import { afterEach, describe, expect, it } from "vitest";
import {
  beginCenterAgentPublicationOperation,
  buildCenterAgentPublicationRequestSignature,
  completeCenterAgentPublicationOperation,
  failCenterAgentPublicationOperation,
} from "../src/center-agent/center-agent-publication-operation-repository";
import {
  applyDrizzleMigrationForTable,
  createSqliteD1Harness,
} from "./helpers/sqlite-d1-harness.test-support";

describe("Center Agent publication operation repository", () => {
  let harness: ReturnType<typeof createSqliteD1Harness> | null = null;

  afterEach(() => {
    harness?.close();
    harness = null;
  });

  it("replays one completed source publication without a second claim", async () => {
    harness = createHarness();
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
    harness = createHarness();
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
    harness = createHarness();
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
    harness = createHarness();
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
    harness = createHarness();
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
    harness = createHarness();
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

function createHarness(): ReturnType<typeof createSqliteD1Harness> {
  const created = createSqliteD1Harness();
  for (const sql of [
    "CREATE TABLE users (id text PRIMARY KEY NOT NULL)",
    "CREATE TABLE organizations (id text PRIMARY KEY NOT NULL)",
    "CREATE TABLE openmeld_profiles (profile_id text PRIMARY KEY NOT NULL)",
    "INSERT INTO users (id) VALUES ('user-a'), ('user-b')",
    "INSERT INTO organizations (id) VALUES ('org-a')",
    "INSERT INTO openmeld_profiles (profile_id) VALUES ('profile-center')",
  ]) {
    created.run({ sql });
  }
  applyDrizzleMigrationForTable(created, "center_agent_publication_operations");
  return created;
}

async function publicationInput(db: D1Database) {
  return {
    db,
    destinationId: "C_RELEASE",
    destinationKind: "slack_channel" as const,
    nowMs: 1001,
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
    actorProfileId: "profile-center",
    organizationId: "org-a",
  };
}

function requireClaimId(claimId: string | null): string {
  if (!claimId) {
    throw new Error("Expected a publication claim id.");
  }
  return claimId;
}
