import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createD1AgentProfileCreationRequestRepository } from "../src/agent-profile-creation-request/agent-profile-creation-request-repository";
import type { AgentProfileCreationRequestRecord } from "../src/agent-profile-creation-request/agent-profile-creation-request-service";

describe("Agent Profile creation request repository", () => {
  it("persists participant visibility, idempotency, transitions, and preferences", async () => {
    const suffix = crypto.randomUUID();
    const organizationId = `org-apcr-${suffix}`;
    const requesterUserId = `user-requester-${suffix}`;
    const targetOwnerUserId = `user-target-${suffix}`;
    await seedIdentity({ organizationId, requesterUserId, targetOwnerUserId });
    const repository = createD1AgentProfileCreationRequestRepository(
      env.OPENMELD_DB
    );
    const record: AgentProfileCreationRequestRecord = {
      actorProfileId: `human-${suffix}`,
      completedAtMs: null,
      createdAgentProfileId: null,
      createdAtMs: 1_787_220_000_000,
      decidedAtMs: null,
      id: `apcr_${suffix}`,
      idempotencyKey: `key-${suffix}`,
      nativeSessionId: null,
      organizationId,
      profileName: "Release Reviewer",
      requestedSpaceId: null,
      requesterUserId,
      sessionStrategy: "new",
      source: "web",
      status: "pending",
      statusReason: "approval_required",
      targetOwnerUserId,
      updatedAtMs: 1_787_220_000_000,
    };

    await expect(repository.insert(record)).resolves.toEqual(record);
    await expect(
      repository.findByIdempotencyKey({
        idempotencyKey: record.idempotencyKey,
        organizationId,
        requesterUserId,
      })
    ).resolves.toEqual(record);
    await expect(
      repository.listForParticipant({
        organizationId,
        userId: requesterUserId,
      })
    ).resolves.toEqual([record]);
    await expect(
      repository.listForParticipant({
        organizationId,
        userId: targetOwnerUserId,
      })
    ).resolves.toEqual([record]);

    const completed = await repository.transition({
      expectedStatuses: ["pending"],
      requestId: record.id,
      update: {
        completedAtMs: 1_787_220_001_000,
        createdAgentProfileId: "agt_11111111-1111-4111-8111-111111111111",
        decidedAtMs: 1_787_220_001_000,
        status: "completed",
        statusReason: "profile_created",
        updatedAtMs: 1_787_220_001_000,
      },
    });

    expect(completed).toMatchObject({
      status: "completed",
      statusReason: "profile_created",
    });
    await expect(
      repository.transition({
        expectedStatuses: ["pending"],
        requestId: record.id,
        update: { status: "cancelled" },
      })
    ).resolves.toBeNull();

    await expect(
      repository.upsertPreference({
        existingSessionPolicy: "never_allow",
        newSessionPolicy: "automatically_allow",
        nowMs: 1_787_220_002_000,
        organizationId,
        userId: targetOwnerUserId,
      })
    ).resolves.toMatchObject({
      existingSessionPolicy: "never_allow",
      newSessionPolicy: "automatically_allow",
    });
    await expect(
      repository.getPreference({ organizationId, userId: targetOwnerUserId })
    ).resolves.toMatchObject({
      existingSessionPolicy: "never_allow",
      newSessionPolicy: "automatically_allow",
    });
  });
});

async function seedIdentity(input: {
  organizationId: string;
  requesterUserId: string;
  targetOwnerUserId: string;
}): Promise<void> {
  const createdAt = 1_787_220_000_000;
  await env.OPENMELD_DB.batch([
    env.OPENMELD_DB.prepare(
      "INSERT INTO organizations (id, name, slug, created_at) VALUES (?, ?, ?, ?)"
    ).bind(
      input.organizationId,
      "Agent Profile Creation Request Test",
      input.organizationId,
      createdAt
    ),
    ...[input.requesterUserId, input.targetOwnerUserId].map((userId) =>
      env.OPENMELD_DB.prepare(
        "INSERT INTO users (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)"
      ).bind(userId, userId, `${userId}@openmeld.invalid`, createdAt, createdAt)
    ),
  ]);
}
