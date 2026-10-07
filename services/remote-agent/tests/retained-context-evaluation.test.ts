import { REMOTE_AGENT_RETAINED_RESULT_TTL_MS } from "@openmeld/schemas";
import { afterEach, expect, it, vi } from "vitest";
import {
  ORIGINAL_CODE,
  projectRetainedContext,
  retainedContextScenario,
} from "./helpers/retained-context-evaluation";

afterEach(() => vi.useRealTimers());

it("recovers exact evidence through the existing owner after removing old previews without changing history", async () => {
  const scenario = await retainedContextScenario();
  const original = JSON.stringify(scenario.context);
  const projection = await projectRetainedContext(scenario);
  expect(projection.removed).toBe(6);
  expect(JSON.stringify(scenario.context)).toBe(original);
  expect(JSON.stringify(projection.context)).not.toContain(ORIGINAL_CODE);
  expect(JSON.stringify(projection.context).length).toBeLessThan(
    original.length / 2
  );
  const first = projection.context.messages.find(
    (message) => message.role === "toolResult"
  );
  if (first?.role !== "toolResult" || first.content[0]?.type !== "text") {
    throw new Error("Missing receipt");
  }
  const receipt = JSON.parse(first.content[0].text);
  expect(receipt.resultMetadata).toMatchObject({
    status: "completed",
    operationId: "archive-0",
  });
  expect(
    JSON.stringify(
      await scenario.read.execute({
        resultId: receipt.presentation.continuation.resultId,
        query: "Archive code",
      })
    )
  ).toContain(ORIGINAL_CODE);
  expect(projection.context.messages.at(-1)).toEqual(
    scenario.context.messages.at(-1)
  );
  expect(projection.context.messages.slice(-5)).toEqual(
    scenario.context.messages.slice(-5)
  );
  scenario.revoke();
  await expect(
    scenario.read.execute({
      resultId: receipt.presentation.continuation.resultId,
    })
  ).rejects.toThrow("evaluation_access_revoked");
  await expect(projectRetainedContext(scenario)).rejects.toThrow(
    "evaluation_access_revoked"
  );
});

it("keeps old previews when their recovery references expire", async () => {
  vi.useFakeTimers();
  const scenario = await retainedContextScenario();
  vi.setSystemTime(Date.now() + REMOTE_AGENT_RETAINED_RESULT_TTL_MS + 1);
  const projection = await projectRetainedContext(scenario);
  expect(projection.removed).toBe(0);
  expect(projection.context).toEqual(scenario.context);
});

it.each([
  "running",
  "failed",
  "unretained",
  "tool-error",
])("keeps %s evidence even when other old previews are removed", async (kind) => {
  const scenario = await retainedContextScenario();
  const message = scenario.context.messages.find(
    (entry) => entry.role === "toolResult"
  );
  if (message?.role !== "toolResult" || message.content[0]?.type !== "text") {
    throw new Error("Missing fixture result");
  }
  const value = JSON.parse(message.content[0].text);
  if (kind === "unretained") {
    value.presentation.continuation = null;
  } else if (kind === "tool-error") {
    message.isError = true;
  } else {
    value.resultMetadata.status = kind;
  }
  message.content[0].text = JSON.stringify(value);
  const projection = await projectRetainedContext(scenario);
  expect(projection.removed).toBe(5);
  expect(
    projection.context.messages.find((entry) => entry.role === "toolResult")
  ).toEqual(message);
});
