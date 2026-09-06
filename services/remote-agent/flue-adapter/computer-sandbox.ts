import type { WorkspaceClient } from "@cloudflare/computer";
import {
  createSandboxSessionEnv,
  type FileStat,
  type SandboxApi,
  type SandboxFactory,
  type ShellResult,
} from "@flue/runtime";
import type {
  RemoteAgentCallbackContext,
  RemoteAgentCoreWorkerBinding,
} from "../agent-core/callback-context";
import { callCoreRpc } from "../agent-core/core-rpc";
import { buildRemoteAgentCoreContext } from "../agent-core/tool-context";
import type { RemoteAgentToolDefinition } from "../agent-core/tool-definition";
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
import type { createAgentComputerFileHandoff } from "./computer-file-handoff";
import { buildAgentComputerName } from "./computer-identity";
import { AGENT_COMPUTER_SHELL_BACKEND_ID } from "./computer-workspace";
import type { createMemberProfileReportComputerFileStore } from "./member-profile-report-computer-files";
import { getOrganizationDocumentComputerToolDefinitions } from "./organization-document-computer-tools";
import {
  getRemoteAgentSandboxToolDefinitions,
  type RemoteAgentComputerSearch,
} from "./sandbox-tools";
import { emitRemoteAgentToolUsage } from "./tool-usage-observability";

const DEFAULT_EXEC_TIMEOUT_MS = 120_000;
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
 * Open the Center Agent's computer and expose it through Flue's sandbox
 * contract, so the read/write/edit/bash/grep/glob tools operate on the
 * durable org-level workspace instead of an ephemeral container.
 */
export async function createRemoteAgentComputerCapability(input: {
  context: RemoteAgentCallbackContext;
  coreWorker: RemoteAgentCoreWorkerBinding;
  env: ComputerObservabilityEnv & { AGENT_COMPUTER?: unknown };
  includeOrganizationDocuments: boolean;
}): Promise<{
  definitions: RemoteAgentToolDefinition[];
  fileHandoff: ReturnType<typeof createAgentComputerFileHandoff>;
  memberProfileReportFiles: ReturnType<
    typeof createMemberProfileReportComputerFileStore
  >;
  sandbox: SandboxFactory;
}> {
  const namespace = input.env.AGENT_COMPUTER as AgentComputerNamespace;
  const workspaceAccess = createAgentComputerWorkspaceAccess({
    computerId: namespace.idFromName(
      buildAgentComputerName(input.context.agentProfileId)
    ),
    namespace,
  });
  const organizationDocumentsSnapshot = input.includeOrganizationDocuments
    ? await callCoreRpc(
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
    : null;
  const { documents, workingDirectory } =
    await materializeAgentComputerWorkspace({
      context: input.context,
      organizationDocumentsSnapshot,
      workspaceAccess,
    });
  const api = instrumentRemoteAgentComputerSandboxApi({
    api: new AgentComputerSandboxApi(workspaceAccess),
    context: input.context,
    env: input.env,
  });
  const sessionEnv = createSandboxSessionEnv(api, workingDirectory);
  const organizationDocumentDefinitions = documents
    ? getOrganizationDocumentComputerToolDefinitions({
        context: input.context,
        coreWorker: input.coreWorker,
        workingCopies: createReacquiringOrganizationDocumentWorkingCopyStore({
          projection: documents,
          workspaceAccess,
          workingDirectory,
        }),
      })
    : [];
  return {
    definitions: [
      ...getRemoteAgentSandboxToolDefinitions({
        computerExec: (command, options) => api.exec(command, options),
        computerSearch: buildComputerSearch(workspaceAccess),
        env: sessionEnv,
        workingDirectory,
      }),
      ...organizationDocumentDefinitions,
    ],
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
  private readonly workspaceAccess: AgentComputerWorkspaceAccess;

  constructor(
    workspaceOrAccess: WorkspaceClient | AgentComputerWorkspaceAccess
  ) {
    this.workspaceAccess =
      "withWorkspace" in workspaceOrAccess
        ? workspaceOrAccess
        : createFixedAgentComputerWorkspaceAccess(workspaceOrAccess);
  }

  async readFile(path: string): Promise<string> {
    return await this.workspaceAccess.withWorkspace(
      async (workspace) => await workspace.fs.readFile(path, "utf8")
    );
  }

  async readFileBuffer(path: string): Promise<Uint8Array> {
    return await this.workspaceAccess.withWorkspace(async (workspace) => {
      const stream = await workspace.fs.readFile(path);
      const chunks: Uint8Array[] = [];
      const reader = stream.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        chunks.push(value);
      }
      const total = chunks.reduce((size, chunk) => size + chunk.byteLength, 0);
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
    options?: {
      backend?: string;
      cwd?: string;
      env?: Record<string, string>;
      signal?: AbortSignal;
      timeoutMs?: number;
    }
  ): Promise<ShellResult> {
    options?.signal?.throwIfAborted();
    return await this.workspaceAccess.withWorkspace(async (workspace) => {
      const handle = await workspace.runtime.exec(command, {
        backend: options?.backend ?? AGENT_COMPUTER_SHELL_BACKEND_ID,
        cwd: options?.cwd,
        encoding: "utf8",
        env: options?.env,
        timeoutMs: options?.timeoutMs ?? DEFAULT_EXEC_TIMEOUT_MS,
      });
      const signal = options?.signal;
      let onAbort: (() => void) | undefined;
      try {
        const resultPromise = handle.result();
        const abortPromise = signal
          ? new Promise<never>((_resolve, reject) => {
              onAbort = () => {
                const stopReason = signal.reason;
                handle.kill("SIGTERM").then(
                  () => reject(stopReason),
                  (killError: unknown) =>
                    reject(
                      new AggregateError(
                        [stopReason, killError],
                        "Computer command could not be stopped."
                      )
                    )
                );
              };
              if (signal.aborted) {
                onAbort();
              } else {
                signal.addEventListener("abort", onAbort, { once: true });
              }
            })
          : null;
        const result = abortPromise
          ? await Promise.race([resultPromise, abortPromise])
          : await resultPromise;
        if (signal?.aborted && abortPromise) {
          await abortPromise;
        }
        return {
          exitCode: result.exitCode,
          stderr: asUtf8Text(result.stderr),
          stdout: asUtf8Text(result.stdout),
        };
      } finally {
        if (onAbort) {
          signal?.removeEventListener("abort", onAbort);
        }
        handle[Symbol.dispose]();
      }
    });
  }
}

function buildComputerSearch(
  workspaceAccess: AgentComputerWorkspaceAccess
): RemoteAgentComputerSearch {
  return {
    grep: (pattern, path, options) =>
      workspaceAccess.withWorkspace(
        async (workspace) => await workspace.fs.grep(pattern, path, options)
      ),
  };
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

function asUtf8Text(value: Uint8Array | string): string {
  return typeof value === "string" ? value : new TextDecoder().decode(value);
}

function estimateSerializedBytes(value: unknown): number {
  try {
    return JSON.stringify(value).length;
  } catch {
    return 0;
  }
}
