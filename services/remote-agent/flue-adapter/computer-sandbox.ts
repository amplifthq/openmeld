import type { WorkspaceClient } from "@cloudflare/computer";
import {
  createSandboxSessionEnv,
  type FileStat,
  type SandboxApi,
  type SandboxFactory,
  type ShellResult,
} from "@flue/runtime";
import { cloudComputerCommandSchema } from "@openmeld/schemas";
import {
  maxLength,
  maxValue,
  minLength,
  minValue,
  number,
  parse,
  pipe,
  strictObject,
  string,
} from "valibot";
import type {
  RemoteAgentCallbackContext,
  RemoteAgentCoreWorkerBinding,
  RemoteAgentStorage,
} from "../agent-core/callback-context";
import { callCoreRpc } from "../agent-core/core-rpc";
import {
  readRemoteAgentExecutionAccess,
  requireRemoteAgentExecutionAccess,
} from "../agent-core/execution-access";
import {
  type RemoteAgentImagePreparer,
  understandRemoteAgentImages,
} from "../agent-core/image-understanding";
import type { RemoteAgentModelEnv } from "../agent-core/model";
import {
  readRemoteAgentResultSources,
  tagRemoteAgentResultSources,
} from "../agent-core/result-access";
import { buildRemoteAgentCoreContext } from "../agent-core/tool-context";
import type { RemoteAgentToolDefinition } from "../agent-core/tool-definition";
import type { ConnectorExecutionConfig } from "../connectors/open-connector-runtime";
import {
  type AgentComputerNamespace,
  type AgentComputerWorkspaceAccess,
  createAgentComputerWorkspaceAccess,
  createFixedAgentComputerWorkspaceAccess,
  createReacquiringAgentComputerFileHandoff,
  createReacquiringMemberProfileReportFileStore,
  createReacquiringOrganizationDocumentWorkingCopyStore,
  materializeAgentComputerWorkspace,
} from "./agent-computer-workspace-access";
import {
  bindComputerCommandTarget,
  createComputerCommandTool,
} from "./computer-command";
import { executeAgentComputerCommand } from "./computer-command-wait";
import type { createAgentComputerFileHandoff } from "./computer-file-handoff";
import {
  type ComputerHelperExecutionOptions,
  executeComputerHelper,
} from "./computer-helper-execution";
import { personalComputerProviderName } from "./computer-identity";
import { createNativeComputerTool } from "./computer-native";
import { createComputerPluginConnectionTool } from "./computer-plugin-connection";
import {
  assertComputerMutationCanContinue,
  authorizeComputerObservation,
  createComputerRecoveryTool,
} from "./computer-recovery";
import { getComputerSpaceFileTools } from "./computer-space-files";
import { getComputerVideoInspectionTool } from "./computer-video-inspection";
import type { AgentComputer } from "./computer-workspace";
import { resolveAgentComputerWorkingDirectory } from "./computer-workspace-config";
import { hasPendingRemoteAgentExecutionInput } from "./execution-input";
import { getGitHubWorkingCopyTools } from "./github-working-copy-tools";
import type { createMemberProfileReportComputerFileStore } from "./member-profile-report-computer-files";
import { prepareOrganizationDocumentsComputerSnapshot } from "./organization-document-computer-snapshot";
import { getOrganizationDocumentComputerToolDefinitions } from "./organization-document-computer-tools";
import { disabledNoNetworkSandbox } from "./sandbox";
import { materializeSpaceWork } from "./space-work-materialization";
import { emitRemoteAgentToolUsage } from "./tool-usage-observability";

const TRAILING_SLASHES_PATTERN = /\/+$/u;

type ComputerObservabilityEnv = {
  OPENMELD_OBSERVABILITY?: AnalyticsEngineDataset;
};

export function isRemoteAgentComputerEnabled(env: {
  AGENT_COMPUTER?: unknown;
  OPENMELD_WORKER_ENVIRONMENT?: string;
}): boolean {
  if (env.AGENT_COMPUTER !== undefined) {
    return true;
  }
  if (env.OPENMELD_WORKER_ENVIRONMENT === "local") {
    return false;
  }
  throw new Error(
    "Remote Agent requires the AGENT_COMPUTER binding outside the local no-computer development lane."
  );
}

/**
 * Expose the Agent's durable Computer through Flue's sandbox contract.
 * Both hosted roles share the same tools; computer identity sets file scope.
 */
export async function createRemoteAgentComputerCapability(input: {
  connectorExecution?: ConnectorExecutionConfig;
  context: RemoteAgentCallbackContext;
  coreWorker: RemoteAgentCoreWorkerBinding;
  env: ComputerObservabilityEnv &
    RemoteAgentModelEnv & {
      AGENT_COMPUTER?: unknown;
      AI?: Ai;
      BROWSER?: unknown;
    };
  includeOrganizationDocuments: boolean;
  prepareImage?: RemoteAgentImagePreparer;
  storage?: RemoteAgentStorage;
}): Promise<{
  definitions: RemoteAgentToolDefinition[];
  fileHandoff: ReturnType<typeof createAgentComputerFileHandoff> | undefined;
  memberProfileReportFiles:
    | ReturnType<typeof createMemberProfileReportComputerFileStore>
    | undefined;
  sandbox: SandboxFactory;
}> {
  if (input.context.computerIsolationVersion !== 3) {
    throw new Error(
      "remote_agent.computer_scope_upgrade_required: Start a new request to use your personal Computer. Existing commands retain their original cleanup address."
    );
  }
  const { computer } = await readRemoteAgentExecutionAccess({
    ...input,
    includeComputer: true,
  });
  if (computer === undefined) {
    throw new Error("computer.identity_unavailable");
  }
  if (computer === null) {
    return {
      definitions: [],
      fileHandoff: undefined,
      memberProfileReportFiles: undefined,
      sandbox: disabledNoNetworkSandbox(),
    };
  }
  const namespace = input.env.AGENT_COMPUTER as AgentComputerNamespace;
  const computerName = personalComputerProviderName(computer.id);
  const computerId = namespace.idFromName(computerName);
  const authorize = async () => await requireRemoteAgentExecutionAccess(input);
  await authorize();
  // Keep the frozen identity and authorization boundary at admission. Opening
  // the remote workspace is optional until a task actually uses Computer.
  const unpreparedWorkspaceAccess = createAgentComputerWorkspaceAccess({
    computerId,
    namespace,
    authorize,
  });
  const baseWorkingDirectory = resolveAgentComputerWorkingDirectory({
    taskId: input.context.submissionId,
    spaceId: input.context.spaceId ?? null,
  });
  let preparation: Promise<void> | undefined;
  const prepareWorkspace = async () => {
    preparation ??= (async () => {
      await (
        namespace.get(computerId) as DurableObjectStub<AgentComputer>
      ).registerComputerInvocation({
        invocationId: input.context.submissionId,
        organizationId: input.context.organizationId,
        spaceId: input.context.spaceId,
        agentProfileId: input.context.agentProfileId,
      });
      return await materializeAgentComputerWorkspace({
        context: input.context,
        workspaceAccess: unpreparedWorkspaceAccess,
      });
    })()
      .then(() => undefined)
      .catch((error: unknown) => {
        // Successful setup is shared by concurrent tools; a failed setup can be
        // attempted by a later tool call without repeating a business operation.
        preparation = undefined;
        throw error;
      });
    await preparation;
  };
  const preparedWorkspaceAccess = createAgentComputerWorkspaceAccess({
    computerId,
    namespace,
    authorize: async () => {
      await authorize();
      await prepareWorkspace();
    },
  });
  const workspaceAccess: AgentComputerWorkspaceAccess = {
    ...preparedWorkspaceAccess,
    computerOperation: async (requestedOperation) => {
      await authorize();
      const operation = await authorizeComputerObservation({
        ...input,
        computerName,
        operation: requestedOperation,
      });
      const observes =
        operation.action === "describe" ||
        (operation.action === "command" &&
          operation.command.action !== "start") ||
        (operation.action === "files" &&
          ["read", "ls", "find", "grep"].includes(operation.tool)) ||
        ["read", "list", "storage", "preview"].includes(operation.action);
      if (!observes && input.storage) {
        await assertComputerMutationCanContinue({
          ...input,
          storage: input.storage,
        });
      }
      const access = observes
        ? unpreparedWorkspaceAccess
        : preparedWorkspaceAccess;
      if (
        operation.action === "command" &&
        operation.command.action === "start" &&
        input.storage
      ) {
        await prepareWorkspace();
        // Routing becomes a cleanup obligation only when a command may be
        // dispatched. Merely offering tools must not couple a reply to Computer.
        await bindComputerCommandTarget({
          storage: input.storage,
          submissionId: input.context.submissionId,
          computerName,
        });
      }
      if (!access.computerOperation) {
        throw new Error("computer.operations_unavailable");
      }
      return await access.computerOperation(operation);
    },
  };
  if (input.context.workHandoff && !input.storage) {
    throw new Error("Durable storage is required to prepare handoff files.");
  }
  const workingDirectory = input.storage
    ? await materializeSpaceWork({
        context: input.context,
        coreWorker: input.coreWorker,
        storage: input.storage,
        workspaceAccess,
        workingDirectory: baseWorkingDirectory,
      })
    : baseWorkingDirectory;
  const nativeApi = new AgentComputerSandboxApi(
    workspaceAccess,
    input.context.submissionId
  );
  const api = instrumentRemoteAgentComputerSandboxApi({
    api: nativeApi,
    context: input.context,
    env: input.env,
  });
  const sessionEnv = createSandboxSessionEnv(api, workingDirectory);
  let workingCopies:
    | Promise<
        ReturnType<typeof createReacquiringOrganizationDocumentWorkingCopyStore>
      >
    | undefined;
  const getWorkingCopies = async () => {
    await authorize();
    workingCopies ??= callCoreRpc(
      input.coreWorker,
      "centerAgentOrganizationDocumentsComputerSnapshot",
      {
        context: buildRemoteAgentCoreContext(
          input.context,
          `remote-agent-computer-documents:${input.context.submissionId}`
        ),
      },
      (binding, rpcInput) =>
        binding.centerAgentOrganizationDocumentsComputerSnapshot?.(rpcInput)
    )
      .then((snapshot) =>
        createReacquiringOrganizationDocumentWorkingCopyStore({
          projection: prepareOrganizationDocumentsComputerSnapshot(snapshot),
          workspaceAccess,
          workingDirectory: baseWorkingDirectory,
        })
      )
      .catch((error: unknown) => {
        workingCopies = undefined;
        throw error;
      });
    return await workingCopies;
  };
  const organizationDocumentDefinitions = input.includeOrganizationDocuments
    ? getOrganizationDocumentComputerToolDefinitions({
        context: input.context,
        coreWorker: input.coreWorker,
        workingCopies: {
          checkout: async (documentId) =>
            (await getWorkingCopies()).checkout(documentId),
          read: async (path) => (await getWorkingCopies()).read(path),
        },
      })
    : [];
  const browserDefinitions: RemoteAgentToolDefinition[] = [];
  if (input.env.BROWSER && input.context.spaceId) {
    const spaceId = input.context.spaceId;
    const browser = () =>
      namespace.get(computerId) as DurableObjectStub<AgentComputer>;
    const browserInput = strictObject({
      code: pipe(string(), minLength(1), maxLength(32_000)),
    });
    browserDefinitions.push({
      name: "browser_execute",
      description:
        "Run a one-shot browser script. First call computer action=describe to read the current browser API. The browser closes when the call completes. Finish navigation and interactions in one call.",
      input: browserInput,
      execute: async (rawInput) => {
        const { code } = parse(browserInput, rawInput);
        await authorize();
        const result = await browser().executeBrowser({ spaceId, code });
        await authorize();
        return result;
      },
    });
    const previewInput = strictObject({
      port: pipe(number(), minValue(1024), maxValue(65_535)),
      path: pipe(string(), minLength(1), maxLength(2048)),
      expectedText: pipe(string(), minLength(1), maxLength(500)),
    });
    browserDefinitions.push({
      name: "computer_preview",
      description:
        "Open a development server already running in this Computer's Linux container with a private one-shot browser. Provide its port, page path, and text expected after JavaScript renders. Returns the rendered text, assertion result, page status, console errors, and failed network requests. Start the server with computer_command first; no public preview URL is created.",
      input: previewInput,
      execute: async (rawInput) => {
        const preview = parse(previewInput, rawInput);
        await authorize();
        const result = await browser().inspectPreview(preview);
        await authorize();
        return result;
      },
    });
  }
  const prepareImage = input.prepareImage;
  const videoModel = input.context.modelRoute?.imageUnderstandingModel;
  const transcriptionAi = input.env.AI;
  const storage = input.storage;
  const hasPendingInput = storage
    ? () =>
        hasPendingRemoteAgentExecutionInput({ context: input.context, storage })
    : undefined;
  return {
    definitions: [
      ...(input.storage
        ? [
            createComputerRecoveryTool({
              ...input,
              computerName,
              storage: input.storage,
              authorize,
            }),
          ]
        : []),
      createNativeComputerTool({
        workspaceAccess,
        invocationId: input.context.submissionId,
        workingDirectory,
        hasPendingInput,
      }),
      ...organizationDocumentDefinitions,
      ...browserDefinitions,
      ...(input.storage && input.connectorExecution
        ? [
            createComputerPluginConnectionTool({
              ...input,
              storage: input.storage,
              connectorExecution: input.connectorExecution,
              workspaceAccess,
            }),
          ]
        : []),
      ...(input.storage && input.connectorExecution
        ? getGitHubWorkingCopyTools({
            context: input.context,
            coreWorker: input.coreWorker,
            connectorExecution: input.connectorExecution,
            storage: input.storage,
            computer: nativeApi,
            workingDirectory,
            workspaceAccess,
          })
        : []),
      ...(input.storage
        ? [
            ...getComputerSpaceFileTools({
              context: input.context,
              coreWorker: input.coreWorker,
              storage: input.storage,
              workspaceAccess,
              workingDirectory,
            }),
            ...(prepareImage && videoModel && transcriptionAi
              ? [
                  getComputerVideoInspectionTool({
                    computerExec: (command, options) =>
                      api.exec(command, options),
                    understandFrames: async (frames) =>
                      await understandRemoteAgentImages({
                        env: input.env,
                        images: frames,
                        model: videoModel,
                        organizationId: input.context.organizationId,
                        prepareImage,
                      }),
                    transcribeAudio: async (bytes) => {
                      const result = await transcriptionAi.run(
                        "@cf/openai/whisper-large-v3-turbo",
                        { audio: Buffer.from(bytes).toString("base64") }
                      );
                      if (typeof result.text !== "string") {
                        throw new Error(
                          "Audio transcription returned no text."
                        );
                      }
                      return result.text.slice(0, 12_000);
                    },
                    storage: input.storage,
                    submissionId: input.context.submissionId,
                    workspaceAccess,
                    workingDirectory,
                  }),
                ]
              : []),
            {
              ...createComputerCommandTool({
                context: input.context,
                storage: input.storage,
                workspaceAccess,
                workingDirectory,
              }),
              execute: async (
                command: Record<string, unknown>,
                options?: { signal?: AbortSignal }
              ) => {
                options?.signal?.throwIfAborted();
                const execute =
                  workspaceAccess.computerOperation?.bind(workspaceAccess);
                if (!execute) {
                  throw new Error("computer.operations_unavailable");
                }
                return await executeAgentComputerCommand({
                  signal: options?.signal,
                  execute,
                  hasPendingInput,
                  operation: {
                    action: "command",
                    invocationId: input.context.submissionId,
                    cwd: workingDirectory,
                    command: cloudComputerCommandSchema.parse(command),
                  },
                });
              },
            },
          ]
        : []),
    ].map((definition) => ({
      ...definition,
      description: `${definition.description}${definition.name === "computer_command" || definition.name === "computer" ? "\nFor this Agent, a poll with positive or omitted waitSeconds waits within the same tool call while the Computer observes the command, including file synchronization. Each native read is bounded. The model resumes when results are ready, Stop arrives, or inspection is needed. Use waitSeconds: 0 only for an immediate status check before independent work. Do not repeatedly request immediate polls just to wait. For result_unavailable with nextAction inspect, poll returns only saved output and the last observed status and exitCode. A saved running status does not prove the process is still running; a null exitCode means no exit was observed. Stop waiting and explain the unavailable result using the retained evidence. Saved output does not prove file synchronization." : ""}\nComputer ${computer.id} belongs to human account ${computer.ownerUserId}. Other Agents and tasks for this account share its files. Current task directory: ${workingDirectory}. Use separate files or Git worktrees for concurrent changes. Decide what to use and share from the original requester, delegation, task and destination audience; filesystem access is not an instruction to disclose personal files.`,
      execute: async (value, options) => {
        if (
          input.storage &&
          [
            "github_checkout_repository",
            "github_publish_checkout",
            "github_publish_computer_file",
            "openmeld_checkout_org_document",
            "openmeld_submit_org_document_working_copy",
            "openmeld_download_space_file",
            "computer_plugin_connection",
          ].includes(definition.name)
        ) {
          await assertComputerMutationCanContinue({
            ...input,
            storage: input.storage,
          });
        }
        const result = await definition.execute(value, options);
        const sources = readRemoteAgentResultSources(result);
        await requireRemoteAgentExecutionAccess({ ...input, sources });
        const tagged =
          sources.length && (result === null || typeof result !== "object")
            ? { result }
            : result;
        return tagRemoteAgentResultSources(tagged, sources);
      },
    })),
    fileHandoff: createReacquiringAgentComputerFileHandoff({
      workspaceAccess,
      workingDirectory,
    }),
    memberProfileReportFiles: createReacquiringMemberProfileReportFileStore({
      workspaceAccess,
    }),
    sandbox: {
      createSandbox: () => Promise.resolve(sessionEnv),
      tools: () => [],
    },
  };
}

/** Adapt the computer workspace onto Flue's SandboxApi contract. */
export class AgentComputerSandboxApi implements SandboxApi {
  private readonly invocationId?: string;
  private readonly workspaceAccess: AgentComputerWorkspaceAccess;

  constructor(
    workspaceOrAccess: WorkspaceClient | AgentComputerWorkspaceAccess,
    invocationId?: string
  ) {
    this.invocationId = invocationId;
    this.workspaceAccess =
      "withWorkspace" in workspaceOrAccess
        ? workspaceOrAccess
        : createFixedAgentComputerWorkspaceAccess(workspaceOrAccess);
  }

  async readFile(path: string, maxBytes?: number): Promise<string> {
    if (maxBytes !== undefined) {
      return new TextDecoder().decode(
        await this.readFileBuffer(path, maxBytes)
      );
    }
    return await this.workspaceAccess.withWorkspace(
      async (workspace) => await workspace.fs.readFile(path, "utf8")
    );
  }

  async readFileBuffer(
    path: string,
    maxBytes = Number.POSITIVE_INFINITY
  ): Promise<Uint8Array> {
    return await this.workspaceAccess.withWorkspace(async (workspace) => {
      const stream = await workspace.fs.readFile(path);
      const chunks: Uint8Array[] = [];
      const reader = stream.getReader();
      let total = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }
          total += value.byteLength;
          if (total > maxBytes) {
            await reader.cancel();
            throw new Error("remote_agent.computer_file_too_large");
          }
          chunks.push(value);
        }
      } finally {
        reader.releaseLock();
      }
      const merged = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return merged;
    });
  }

  async writeFile(path: string, content: string | Uint8Array): Promise<void> {
    if (this.workspaceAccess.writeComputerFile) {
      await this.workspaceAccess.writeComputerFile(path, content);
      return;
    }
    await this.workspaceAccess.withWorkspace(async (workspace) => {
      const parent = parentDirectory(path);
      if (parent) {
        await workspace.fs.mkdir(parent, { recursive: true });
      }
      await workspace.fs.writeFile(path, content);
    });
  }

  async stat(path: string): Promise<FileStat> {
    return await this.workspaceAccess.withWorkspace(async (workspace) => {
      const result = await workspace.fs.stat(path);
      return {
        isDirectory: result.isDirectory,
        isFile: result.isFile,
        isSymbolicLink: result.isSymbolicLink,
        mtime: new Date(result.mtime),
        size: result.size,
      };
    });
  }

  async readdir(path: string): Promise<string[]> {
    return await this.workspaceAccess.withWorkspace(async (workspace) => {
      const entries = await workspace.fs.readdir(path);
      return entries.map((entry) => entry.name);
    });
  }

  async exists(path: string): Promise<boolean> {
    return await this.workspaceAccess.withWorkspace(async (workspace) => {
      try {
        await workspace.fs.stat(path);
        return true;
      } catch (error) {
        if (
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          error.code === "ENOENT"
        ) {
          return false;
        }
        throw error;
      }
    });
  }

  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    await this.workspaceAccess.withWorkspace(
      async (workspace) => await workspace.fs.mkdir(path, options)
    );
  }

  async rm(
    path: string,
    options?: { force?: boolean; recursive?: boolean }
  ): Promise<void> {
    await this.workspaceAccess.withWorkspace(
      async (workspace) => await workspace.fs.rm(path, options)
    );
  }

  async exec(
    command: string,
    options?: ComputerHelperExecutionOptions
  ): Promise<ShellResult> {
    if (!this.invocationId) {
      throw new Error("computer.execution_identity_unavailable");
    }
    return await executeComputerHelper({
      workspaceAccess: this.workspaceAccess,
      invocationId: this.invocationId,
      command,
      options,
    });
  }
}

export function instrumentRemoteAgentComputerSandboxApi(input: {
  api: SandboxApi;
  context: RemoteAgentCallbackContext;
  env: ComputerObservabilityEnv;
}): SandboxApi {
  const observe = async <T>(
    operation: string,
    operationInput: unknown,
    run: () => Promise<T>
  ) => {
    const startedAt = Date.now();
    let outcome: "failed" | "succeeded" = "failed";
    let outputBytes = 0;
    try {
      const result = await run();
      outputBytes = estimateSerializedBytes(result);
      outcome = "succeeded";
      return result;
    } finally {
      emitRemoteAgentToolUsage(input.env, {
        durationMs: Date.now() - startedAt,
        inputBytes: estimateSerializedBytes(operationInput),
        operation,
        organizationId: input.context.organizationId,
        outcome,
        outputBytes,
        provider: "cloudflare_computer",
        recordedAt: new Date().toISOString(),
        spaceId: input.context.spaceId,
        submissionId: input.context.submissionId,
        toolName: computerToolName(operation),
      });
    }
  };

  return {
    exec: async (command, options) =>
      await observe("exec", { command, options }, () =>
        input.api.exec(command, options)
      ),
    exists: async (path) =>
      await observe("exists", { path }, () => input.api.exists(path)),
    mkdir: async (path, options) =>
      await observe("mkdir", { options, path }, () =>
        input.api.mkdir(path, options)
      ),
    readFile: async (path) =>
      await observe("read_file", { path }, () => input.api.readFile(path)),
    readFileBuffer: async (path) =>
      await observe("read_file_buffer", { path }, () =>
        input.api.readFileBuffer(path)
      ),
    readdir: async (path) =>
      await observe("readdir", { path }, () => input.api.readdir(path)),
    rm: async (path, options) =>
      await observe("rm", { options, path }, () => input.api.rm(path, options)),
    stat: async (path) =>
      await observe("stat", { path }, () => input.api.stat(path)),
    writeFile: async (path, content) =>
      await observe("write_file", { path }, () =>
        input.api.writeFile(path, content)
      ),
  };
}

function computerToolName(operation: string): string {
  switch (operation) {
    case "exec":
      return "bash";
    case "read_file":
      return "read";
    case "write_file":
      return "write";
    default:
      return "computer_filesystem";
  }
}

function parentDirectory(path: string): string | null {
  const normalized = path.replace(TRAILING_SLASHES_PATTERN, "");
  const index = normalized.lastIndexOf("/");
  if (index <= 0) {
    return null;
  }
  return normalized.slice(0, index);
}

function estimateSerializedBytes(value: unknown): number {
  try {
    return JSON.stringify(value).length;
  } catch {
    return 0;
  }
}
