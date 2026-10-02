import { openMeldDaemonTaskResultPayloadSchema } from "@openmeld/schemas";
import type { OpenMeldDaemonTaskResultPayload } from "@openmeld/schemas/types";
import { expect, it } from "vitest";
import { createDispatchAiUsageCollector } from "../src/local-service/dispatch/dispatch-ai-usage";

it("carries late native receipts and repair turns in a CLI reply without counting a replay twice", () => {
  const collector = createDispatchAiUsageCollector();
  const proposal: OpenMeldDaemonTaskResultPayload = {
    agentId: "agt_11111111-1111-4111-8111-111111111111",
    attemptId: "attempt-1",
    deduped: false,
    sourceEventId: "source-1",
    status: "success",
    output: "Done",
    taskId: "task-1",
  };
  expect(collector.apply(proposal)).not.toHaveProperty("telemetry");
  for (const eventId of ["native-1", "native-1", "native-repair-2"]) {
    collector.observe({
      invokedAtMs: 1,
      completedAtMs: 2,
      resumedContext: false,
      aiUsage: [
        {
          eventId,
          provider: "openai",
          model: "gpt-5.5",
          source: "codex_event",
          occurredAtMs: 2,
          tokens: {
            input: 100,
            output: 20,
            total: 120,
            cacheRead: 0,
            cacheWrite: null,
            reasoning: 5,
          },
          cost: null,
        },
      ],
    });
  }
  const result = openMeldDaemonTaskResultPayloadSchema.parse(
    collector.apply(proposal)
  );
  expect(result).toMatchObject(proposal);
  expect(result.telemetry?.aiUsage?.map((usage) => usage.eventId)).toEqual([
    "native-1",
    "native-repair-2",
  ]);
  expect(
    result.telemetry?.aiUsage?.reduce(
      (total, usage) => total + (usage.tokens?.total ?? 0),
      0
    )
  ).toBe(240);
});
