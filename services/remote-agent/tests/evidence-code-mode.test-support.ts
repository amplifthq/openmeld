import type { Executor } from "@cloudflare/codemode";
import { createCodeTool } from "@cloudflare/codemode/ai";
import type { RemoteAgentCoreWorkerBinding } from "../agent-core/callback-context";
import type { RemoteAgentOpenMeldToolName } from "../agent-core/tools";
import {
  REMOTE_AGENT_CAPABILITY_DESCRIBE_TOOL_NAME,
  REMOTE_AGENT_CAPABILITY_SEARCH_TOOL_NAME,
} from "../flue-adapter/capability-discovery";
import { REMOTE_AGENT_CODE_MODE_TOOL_NAME } from "../flue-adapter/code-mode";
import { getRemoteAgentFlueTools } from "../flue-adapter/tools";
import {
  type createEvidenceFixture,
  EVIDENCE_SUBMISSION_ID,
} from "./center-agent-evidence.test-support";

const EVIDENCE_DISCOVERY_QUERIES: Partial<
  Record<RemoteAgentOpenMeldToolName, string>
> = {
  openmeld_read_center_agent_activity: "Center Agent 操作记录",
  openmeld_read_agent_activity: "查看编码代理活动概览",
  openmeld_list_routine_runs: "定时任务历史",
  openmeld_read_routine_run_diagnostics: "定时任务诊断",
  openmeld_search_center_agent_memory: "查找之前的结论",
};

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
  const { tools } = await getRemoteAgentFlueTools({
    coreWorker: input.binding,
    agentActivityReadEnabled: true,
    turnEnvelope: input.fixture.request.turnEnvelope,
    env: { LOADER: {} as WorkerLoader },
    codeModeRuntime: {
      createExecutor: () => executor,
      createCodeTool: (options) => createCodeTool({ ...options, executor }),
    },
    storage: input.fixture.storage,
    submissionId: EVIDENCE_SUBMISSION_ID,
  });
  async function run(
    name: string,
    data: Record<string, unknown>
  ): Promise<unknown> {
    const tool = tools.find((candidate) => candidate.name === name);
    if (!tool) {
      throw new Error(`Frozen turn catalog lacks ${name}.`);
    }
    // Dispatch the heterogeneous frozen catalog by name, preserving the real
    // tool receiver and handler instead of substituting a test implementation.
    const result: unknown = await Reflect.apply(tool.run, tool, [
      {
        data,
        log: console,
        toolCallId: `evidence-${name}`,
      },
    ]);
    if (!result || typeof result !== "object" || !("output" in result)) {
      throw new Error(`${name} returned no tool result envelope.`);
    }
    return result.output;
  }
  const discovery = (await run(REMOTE_AGENT_CAPABILITY_SEARCH_TOOL_NAME, {
    query: EVIDENCE_DISCOVERY_QUERIES[input.toolName] ?? input.toolName,
    limit: 12,
  })) as { capabilities: { name: string }[] };
  if (!discovery.capabilities.some((entry) => entry.name === input.toolName)) {
    throw new Error(
      `The normal discovery path did not find ${input.toolName}.`
    );
  }
  const described = (await run(REMOTE_AGENT_CAPABILITY_DESCRIBE_TOOL_NAME, {
    names: [input.toolName],
  })) as {
    capabilities: {
      name: string;
      inputSchema: { properties?: Record<string, unknown> };
    }[];
    unknownNames: string[];
  };
  const description = described.capabilities.find(
    (entry) => entry.name === input.toolName
  );
  if (
    !description?.inputSchema ||
    described.unknownNames.includes(input.toolName)
  ) {
    throw new Error(`The frozen catalog cannot describe ${input.toolName}.`);
  }
  for (const key of ["context", "speakerMember", "graphId", "submissionId"]) {
    if (description.inputSchema.properties?.[key]) {
      throw new Error(`Model controls authority field ${key}.`);
    }
  }
  return await run(REMOTE_AGENT_CODE_MODE_TOOL_NAME, { code });
}
