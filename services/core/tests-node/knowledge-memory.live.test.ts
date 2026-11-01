import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { expect, it } from "vitest";
import { buildCenterAgentMemberMemoryRef } from "../src/center-agent-memory/contract";
import { createZepCenterAgentMemoryAdapter } from "../src/center-agent-memory/zep-memory-adapter";

const REPORT_FORMAT_PATTERN = /table|column/i;

// Opt-in provider diagnostic. This is deliberately not an end-to-end product test.
// Every run creates its own fictional subject; no existing user or graph is read.
it.skipIf(process.env.OPENMELD_LIVE_MEMORY_EVAL !== "dev-synthetic")(
  "extracts a held-out synthetic preference through the live dev provider",
  async () => {
    expect(process.env.DOPPLER_PROJECT).toBe("openmeld-core");
    expect(process.env.DOPPLER_CONFIG).toBe("dev");
    const apiKey = process.env.ZEP_OPENMELD_API_KEY;
    if (!apiKey) {
      throw new Error("The dev Zep key is unavailable.");
    }
    const id = `knowledge-eval-${randomUUID()}`;
    const ref = buildCenterAgentMemberMemoryRef({
      organizationId: id,
      memberId: id,
      userId: id,
    });
    const adapter = createZepCenterAgentMemoryAdapter({ apiKey });
    const started = Date.now();
    await adapter.ensureMemberUser(ref);
    try {
      await adapter.addEpisode({
        ref,
        episode: {
          captureMethod: "automatic_turn",
          source: "ca_dm",
          sourceConversationId: id,
          sourceMessageId: `${id}-1`,
          occurredAtMs: started,
          userMessage:
            "This is fictional evaluation data. For the Cedar Kite project, I prefer weekly progress reports as a two-column table: completed work and next action.",
          assistantMessage:
            "Understood: a two-column table for Cedar Kite weekly progress reports.",
        },
      });
      const acceptedMs = Date.now() - started;
      let found = false;
      let attempts = 0;
      while (Date.now() - started < 120_000) {
        attempts++;
        const { items: results } = await adapter.search({
          ref,
          limit: 6,
          query: "Cedar Kite weekly progress report format preference",
        });
        found = results.some(
          (item) =>
            REPORT_FORMAT_PATTERN.test(item.text) &&
            item.sourceConversationId === id &&
            item.sourceMessageId === `${id}-1`
        );
        if (found) {
          break;
        }
        await delay(5000);
      }
      console.log(
        JSON.stringify({
          diagnostic: "synthetic_live_memory",
          startedAt: new Date(started).toISOString(),
          acceptedMs,
          searchableMs: Date.now() - started,
          attempts,
          found,
          cost: "provider billing not exposed by this adapter",
        })
      );
      expect(
        found,
        "Provider acceptance is not searchable memory; bounded extraction wait expired"
      ).toBe(true);
    } finally {
      // Only the exact subject minted by this invocation is deleted.
      await adapter.deleteMemberUser(ref);
    }
  },
  150_000
);
