import type { Executor } from "@cloudflare/codemode";
import { createCodeTool } from "@cloudflare/codemode/ai";
import type { RemoteAgentCoreWorkerBinding } from "../agent-core/callback-context";
import type { RemoteAgentOpenMeldToolName } from "../agent-core/tools";
import { createRemoteAgentCodeModeFlueTool } from "../flue-adapter/code-mode";
import {
  type createEvidenceFixture,
  EVIDENCE_SUBMISSION_ID,
} from "./center-agent-evidence.test-support";

/** Real SDK/tool/result boundaries; only the external JavaScript executor is controlled. */
export async function executeEvidenceCodeMode(input: {
  fixture: Awaited<ReturnType<typeof createEvidenceFixture>>;
  binding: RemoteAgentCoreWorkerBinding;
  toolName: RemoteAgentOpenMeldToolName;
  payload?: Record<string, unknown>;
}) {
  const payload = input.payload ?? {};
  const code = `async () => await codemode.${input.toolName}(${JSON.stringify(payload)})`;
  const executor: Executor = {
    async execute(requestedCode, providers) {
      if (requestedCode !== code || !Array.isArray(providers)) {
        throw new Error("Expected the declared bounded evidence invocation.");
      }
      const operation = providers[0]?.fns[input.toolName];
      if (!operation) {
        throw new Error(`The SDK did not expose ${input.toolName}.`);
      }
      return { result: await operation(payload) };
    },
  };
  const tool = await createRemoteAgentCodeModeFlueTool({
    coreWorker: input.binding,
    definitions: input.fixture.tools(input.binding),
    env: {},
    loader: {} as WorkerLoader,
    runtime: {
      createExecutor: () => executor,
      createCodeTool: (options) => createCodeTool({ ...options, executor }),
    },
    storage: input.fixture.storage,
    submissionId: EVIDENCE_SUBMISSION_ID,
  });
  const result = await tool.run({
    data: { code },
    log: console,
    toolCallId: "evidence-code-mode",
  });
  if (!result || typeof result !== "object" || !("output" in result)) {
    throw new Error("Code Mode returned no tool result envelope.");
  }
  return result.output;
}
