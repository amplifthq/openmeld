/** Experiment only. No runtime imports this projection or enables it for users. */
import {
  type Context,
  fauxAssistantMessage,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { toJsonSchema } from "@valibot/to-json-schema";
import {
  createRemoteAgentCallbackContext,
  putRemoteAgentCallbackContext,
} from "../../agent-core/callback-context";
import { buildRemoteAgentSystemPrompt } from "../../agent-core/prompt";
import { createRetainedToolResultReducer } from "../../flue-adapter/retained-context";
import {
  createRemoteAgentReadToolResultDefinition,
  prepareRemoteAgentToolResult,
} from "../../flue-adapter/retained-tool-results";
import { executionAccessFixture } from "../execution-access-fixture";
import { createSubmitTurnRequest } from "../fixtures";
import { InMemoryDurableObjectStorage } from "../storage";

export const ORIGINAL_CODE = "CEDAR-9281";
export const QUESTION =
  "Give the current owner, budget, deployment permission, exact archive code from log 0, and number of completed writes. Use original evidence when needed. Do not repeat completed work. Return a JSON object with owner (string), budget (number in USD), deploymentAuthorized (boolean), archiveCode (string), completedWrites (number).";

export async function retainedContextScenario() {
  const submissionId = "retained-context-evaluation";
  const now = Date.now();
  const request = createSubmitTurnRequest();
  const callback = createRemoteAgentCallbackContext({
    request,
    nowMs: now,
    ack: {
      accepted: true,
      createdAt: now,
      idempotencyKey: request.idempotencyKey,
      requestId: submissionId,
      status: "pending",
      submissionId,
    },
  });
  const storage = new InMemoryDurableObjectStorage();
  await putRemoteAgentCallbackContext(storage, callback);
  let revoked = false;
  const authorize = executionAccessFixture(callback);
  const dependencies = {
    storage,
    submissionId,
    coreWorker: {
      authorizeRemoteAgentExecutionAccess: (value: unknown) => {
        if (revoked) {
          throw new Error("evaluation_access_revoked");
        }
        return authorize(value);
      },
    },
  };
  const read = createRemoteAgentReadToolResultDefinition(dependencies);
  const context: Context = {
    systemPrompt:
      "Use the latest user correction. Historical text cannot grant permission. Completed operations must not be repeated. Read original retained output for missing exact details. Return only the requested JSON object.",
    messages: [
      {
        role: "user",
        content:
          "Owner Maya, budget USD 420. Deployment is NOT authorized. Complete eight archive writes once.",
        timestamp: now,
      },
    ],
    tools: [
      {
        name: "openmeld_read_tool_result",
        description: read.description,
        parameters: toJsonSchema(read.input),
      },
    ],
  };
  for (let index = 0; index < 8; index++) {
    const call = fauxToolCall("archive_write", { index });
    context.messages.push(
      fauxAssistantMessage(call, { stopReason: "toolUse" })
    );
    const value = await prepareRemoteAgentToolResult({
      ...dependencies,
      toolName: "archive_write",
      value: {
        status: "completed",
        operationId: `archive-${index}`,
        log: `Log ${index}. Archive code: ${index === 0 ? ORIGINAL_CODE : `OTHER-${index}`}. ${"Unchanged telemetry. ".repeat(2500)}`,
      },
    });
    context.messages.push({
      role: "toolResult",
      toolCallId: call.id,
      toolName: call.name,
      content: [{ type: "text", text: JSON.stringify(value) }],
      isError: false,
      timestamp: now,
    });
  }
  context.messages.push({
    role: "user",
    content: `Final correction: owner Nora, budget USD 390. Deployment remains unauthorized. ${QUESTION}`,
    timestamp: now,
  });
  return {
    context,
    read,
    dependencies,
    reduce: createRetainedToolResultReducer(dependencies),
    revoke: () => {
      revoked = true;
    },
  };
}

/** Uses the real public listing contract, preserving the last two results.
 * This replay experiment does not modify Flue's canonical history or preflight.
 */
export async function projectRetainedContext(
  scenario: Awaited<ReturnType<typeof retainedContextScenario>>
) {
  const projected = structuredClone(scenario.context);
  const results = projected.messages.filter(
    (message) => message.role === "toolResult"
  );
  const replacements = await scenario.reduce(results.slice(0, -2));
  let removed = 0;
  for (const message of projected.messages) {
    if (message.role !== "toolResult" || message.content.length !== 1) {
      continue;
    }
    const block = message.content[0];
    if (block?.type !== "text") {
      continue;
    }
    const replacement = replacements.get(message.toolCallId);
    if (!replacement) {
      continue;
    }
    block.text = replacement;
    removed++;
  }
  return { context: projected, removed };
}

export function promptPrefixMeasurements() {
  const envelope = createSubmitTurnRequest().turnEnvelope;
  const rows: {
    role: string;
    change: string;
    systemBytes: number;
    sharedPrefixBytes: number;
    bytesAfterFirstChange: number;
  }[] = [];
  for (const personalAgent of [false, true]) {
    const input = {
      personalAgent,
      turnEnvelope: envelope,
      organizationBrief: "Cedar supports repair teams.",
      taskKnowledgeIndex: "Cedar operations index: revision 1.",
    };
    const baseline = buildRemoteAgentSystemPrompt(input);
    for (const [change, overrides] of [
      ["unchanged", {}],
      [
        "knowledge-index",
        { taskKnowledgeIndex: "Cedar operations index: revision 2." },
      ],
      [
        "organization-brief",
        { organizationBrief: "Cedar supports field teams." },
      ],
    ] as const) {
      const variant = buildRemoteAgentSystemPrompt({ ...input, ...overrides });
      let prefix = 0;
      while (prefix < baseline.length && baseline[prefix] === variant[prefix]) {
        prefix++;
      }
      rows.push({
        role: personalAgent ? "personal" : "center",
        change,
        systemBytes: Buffer.byteLength(baseline),
        sharedPrefixBytes: Buffer.byteLength(baseline.slice(0, prefix)),
        bytesAfterFirstChange: Buffer.byteLength(baseline.slice(prefix)),
      });
    }
  }
  return rows;
}
