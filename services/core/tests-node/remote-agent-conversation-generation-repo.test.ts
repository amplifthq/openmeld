import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  advanceRemoteAgentConversationGeneration,
  markRemoteAgentConversationGenerationStarted,
  readRemoteAgentConversationGeneration,
} from "../src/remote-agent/infrastructure/postgresql/conversation-generation-repo";
import { createPostgresHarness } from "./helpers/postgresql-harness.test-support";

describe("Remote Agent conversation generation repository", () => {
  let harness: Awaited<ReturnType<typeof createPostgresHarness>>;

  beforeEach(async () => {
    harness = await createPostgresHarness();
  });

  afterEach(async () => {
    await harness.close();
  });

  it("treats a conversation without a pointer as legacy generation zero", async () => {
    await expect(
      readRemoteAgentConversationGeneration({
        db: harness.db,
        logicalConversationId: "space-1",
        organizationId: "org-1",
      })
    ).resolves.toEqual({ generation: 0, startedAtMs: null });
  });

  it("advances concurrent rollover attempts to one shared next generation", async () => {
    const first = await advanceRemoteAgentConversationGeneration({
      db: harness.db,
      deliveryId: "delivery-1",
      expectedGeneration: 0,
      logicalConversationId: "space-1",
      nowMs: 1000,
      organizationId: "org-1",
    });
    const second = await advanceRemoteAgentConversationGeneration({
      db: harness.db,
      deliveryId: "delivery-2",
      expectedGeneration: 0,
      logicalConversationId: "space-1",
      nowMs: 1001,
      organizationId: "org-1",
    });

    expect(first).toEqual({ generation: 1, startedAtMs: null });
    expect(second).toEqual({ generation: 1, startedAtMs: null });
    expect(
      await harness.queryFirst<{
        active_generation: number;
        rollover_delivery_id: string;
      }>({
        text: `
          SELECT active_generation, rollover_delivery_id
          FROM "openmeld"."openMeldRemoteAgent_conversation_generations"
          WHERE organization_id = 'org-1'
            AND logical_conversation_id = 'space-1'
        `,
      })
    ).toEqual({
      active_generation: 1,
      rollover_delivery_id: "delivery-1",
    });
  });

  it("marks only the still-active generation as started", async () => {
    await advanceRemoteAgentConversationGeneration({
      db: harness.db,
      deliveryId: "delivery-1",
      expectedGeneration: 0,
      logicalConversationId: "space-1",
      nowMs: 1000,
      organizationId: "org-1",
    });

    await expect(
      markRemoteAgentConversationGenerationStarted({
        db: harness.db,
        generation: 1,
        logicalConversationId: "space-1",
        nowMs: 1010,
        organizationId: "org-1",
      })
    ).resolves.toBe(true);
    await expect(
      markRemoteAgentConversationGenerationStarted({
        db: harness.db,
        generation: 0,
        logicalConversationId: "space-1",
        nowMs: 1020,
        organizationId: "org-1",
      })
    ).resolves.toBe(false);
    await expect(
      readRemoteAgentConversationGeneration({
        db: harness.db,
        logicalConversationId: "space-1",
        organizationId: "org-1",
      })
    ).resolves.toEqual({ generation: 1, startedAtMs: 1010 });
  });
});
