import { DurableObject } from "cloudflare:workers";
import { posix } from "node:path";
import { getWorkspace, Workspace, WorkspaceStub } from "@cloudflare/computer";
import {
  LegacyContainerBackend,
  withLegacyWorkspaceContainer,
} from "@cloudflare/computer/backends/container-legacy";
import { WorkerJavaScriptBackend } from "@cloudflare/computer/backends/worker-javascript";
import { WorkerShellBackend } from "@cloudflare/computer/backends/worker-shell";
import { createArtifactsModule } from "@cloudflare/computer/modules/artifacts";
import { createGitModule } from "@cloudflare/computer/modules/git";
import curlModules from "@cloudflare/computer/shell/curl";
import fileModules from "@cloudflare/computer/shell/file";
import htmlToMarkdownModules from "@cloudflare/computer/shell/html-to-markdown";
import jqModules from "@cloudflare/computer/shell/jq";
import jsExecModules from "@cloudflare/computer/shell/js-exec";
import pythonModules from "@cloudflare/computer/shell/python";
import sqliteModules from "@cloudflare/computer/shell/sqlite";
import xanModules from "@cloudflare/computer/shell/xan";
import yqModules from "@cloudflare/computer/shell/yq";
import {
  agentComputerBrowserRequestSchema,
  agentComputerPreviewRequestSchema,
  type CloudComputerOperation,
  cloudComputerOperationSchema,
  type PluginConnectionGrant,
  pluginConnectionGrantSchema,
  type RemoteAgentGitPackStart,
  type RemoteAgentGitPackStatus,
  type RemoteAgentGitTransferGrant,
  remoteAgentGitPackStartSchema,
  remoteAgentGitTransferGrantSchema,
} from "@openmeld/schemas";
import type { BrowserBinding } from "agents/browser";
import { createBrowserTools } from "agents/browser/ai";
import type { RemoteAgentCoreWorkerBinding } from "../agent-core/callback-context";
import { forwardGitConnectionRequest } from "../connectors/github-connection-transport";
import { forwardPluginConnection } from "../connectors/plugin-connection";
import {
  ACCOUNT_ERASED_KEY,
  eraseAccountStorage,
  requireRetainedAccountStorage,
} from "./account-deletion";
import {
  collectComputerCommands,
  createComputerCommandTool,
  listPendingRemoteAgentComputerCommands,
  readStoredComputerInvocation,
  requestStoredComputerCleanup,
  stopStoredComputerCommands,
} from "./computer-command";
import { ComputerCommandSqlStorage } from "./computer-command-storage";
import { ComputerFiles } from "./computer-files";
import { ComputerIdleGuard } from "./computer-idle";
import {
  readComputerRecovery,
  registerComputerInvocation,
} from "./computer-invocations";
import { createComputerFileTools, describeComputer } from "./computer-native";
import {
  inspectComputerPreview,
  type PreviewBrowserBinding,
  validateComputerPreviewPort,
} from "./computer-preview";
import {
  describeComputerStorage,
  withComputerCapacityErrors,
} from "./computer-storage";
import {
  AGENT_COMPUTER_BINDING,
  AGENT_COMPUTER_CONTAINER_BACKEND_ID,
  AGENT_COMPUTER_CONTAINER_ENV,
  AGENT_COMPUTER_SHELL_BACKEND_ID,
  AGENT_COMPUTER_STORAGE_CAPACITY_BYTES,
  buildAgentComputerSpaceDirectory,
} from "./computer-workspace-config";
import {
  COMPUTER_GIT_PATH,
  COMPUTER_PLUGIN_PATH,
} from "./computer-workspace-proxy";
import { authorizeGitTransfer } from "./git-transfer-authorization";
import {
  gitUploadPackBytes,
  gitUploadPackRequest,
} from "./git-upload-pack-stream";
import { authorizePluginConnection } from "./plugin-connection-authorization";

/**
 * The human account's Computer: a durable workspace backed by
 * the Durable Object's SQLite storage via `@cloudflare/computer`.
 *
 * Files live in the DO (durable across restarts and independent of any
 * container lifetime). There is exactly one file world with three
 * execution engines over it:
 *
 * - worker-shell: just-bash in a Dynamic Worker minted
 *   through `env.LOADER`, reaching this workspace over Workers RPC.
 *   Built-in shell commands and HTTP, without native binaries.
 * - worker-javascript: an ECMAScript module in a fresh Dynamic Worker,
 *   with workspace files, fetch, and structured input and results.
 * - container (default): computerd in a Cloudflare Container, FUSE-mounting this
 *   same workspace at /computer. Full Linux userland (python, git,
 *   real binaries); syncs changes back over capnweb.
 */

const COMPUTER_PREVIEW_PATH = /^\/__preview\/(\d+)(\/.*)?$/u;

type AgentComputerEnv = {
  LOADER: WorkerLoader;
  BROWSER?: BrowserBinding;
  OPENMELD_CORE_WORKER: RemoteAgentCoreWorkerBinding;
  OPENMELD_CONNECTORS_BASE_URL: string;
  OPEN_CONNECTOR_OPENMELD_RUNTIME_TOKEN: string;
};

const GIT_TRANSFER_GRANT_PREFIX = "openmeld:git-transfer-grant:";
const GIT_PACK_JOB_PREFIX = "openmeld:git-pack-job:";
const GIT_PACK_RETRY_AFTER_MS = 13 * 60 * 1000;

// The SDK disposes this target when its remote Workspace client is released.
// Workers RPC also disposes targets when their caller's event ends.
class ActiveWorkspaceStub extends WorkspaceStub {
  readonly #release: () => void;

  constructor(workspace: Workspace, release: () => void) {
    super(workspace);
    this.#release = release;
  }

  override [Symbol.dispose]() {
    try {
      super[Symbol.dispose]();
    } finally {
      this.#release();
    }
  }
}

function parseGitEgressRoute(request: Request):
  | {
      operationId: string;
      owner: string;
      repo: string;
      endpoint: string;
      search: string;
    }
  | Response {
  const target = new URL(request.url);
  const match = COMPUTER_GIT_PATH.exec(target.pathname);
  if (!match) {
    return new Response("Git transfer path is unavailable.", { status: 404 });
  }
  const [, operationId, owner, repo, endpoint] = match;
  if (
    !(operationId && owner && repo && endpoint) ||
    (endpoint === "info/refs" && request.method !== "GET") ||
    (endpoint === "git-upload-pack" && request.method !== "POST")
  ) {
    return new Response("Git transfer method is unavailable.", { status: 405 });
  }
  return { operationId, owner, repo, endpoint, search: target.search };
}

function observeGitStream(
  stream: ReadableStream<Uint8Array>,
  input: { operationId: string; direction: "upload" | "download" }
): ReadableStream<Uint8Array> {
  const startedAtMs = Date.now();
  let bytes = 0;
  return stream.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        bytes += chunk.byteLength;
        controller.enqueue(chunk);
      },
      flush() {
        console.info("[remote_agent.git_transfer_stream]", {
          operationId: input.operationId,
          direction: input.direction,
          bytes,
          durationMs: Date.now() - startedAtMs,
        });
      },
    })
  );
}

class AgentComputerBase extends DurableObject<AgentComputerEnv> {}

type GitPackJob = RemoteAgentGitPackStart & {
  status: RemoteAgentGitPackStatus["status"];
  attempt: number;
  startedAtMs: number | null;
  bytes: number | null;
  errorCode: string | null;
};

function gitPackPath(job: GitPackJob): string {
  return `${job.transportDirectory}/pack-${job.attempt}.pack`;
}

function gitPackStatus(job: GitPackJob): RemoteAgentGitPackStatus {
  return {
    status: job.status,
    path: job.status === "available" ? gitPackPath(job) : null,
    bytes: job.bytes,
    errorCode: job.errorCode,
  };
}

function workspaceRef(ctx: DurableObjectState) {
  return { binding: AGENT_COMPUTER_BINDING, id: ctx.id.toString() };
}

export class AgentComputer extends withLegacyWorkspaceContainer(
  AgentComputerBase
) {
  async eraseAccountSpaceDirectory(spaceId: string): Promise<void> {
    return await this.#withActivity(() =>
      this.#eraseAccountSpaceDirectory(spaceId)
    );
  }

  async #eraseAccountSpaceDirectory(spaceId: string): Promise<void> {
    await requireRetainedAccountStorage(this.ctx.storage);
    await this.workspace.ready();
    await this.workspace.fs.rm(buildAgentComputerSpaceDirectory(spaceId), {
      recursive: true,
      force: true,
    });
  }
  async eraseAccountComputer(): Promise<void> {
    return await this.ctx.blockConcurrencyWhile(async () => {
      if (await this.ctx.storage.get(ACCOUNT_ERASED_KEY)) {
        return;
      }
      await this.ctx.container?.destroy();
      await this.workspace.close();
      await eraseAccountStorage(this.ctx);
    });
  }
  readonly #commands = new ComputerCommandSqlStorage(this.ctx.storage.sql);
  readonly #idle = new ComputerIdleGuard();
  #maintenanceRevision = 0;
  #maintenanceAlarm: Promise<void> | undefined;

  private requestWorkspaceMaintenance() {
    this.#maintenanceRevision++;
    if (this.#maintenanceAlarm) {
      return;
    }
    this.#maintenanceAlarm = this.scheduleAlarm(Date.now() + 250).finally(
      () => {
        this.#maintenanceAlarm = undefined;
      }
    );
    this.ctx.waitUntil(this.#maintenanceAlarm);
  }

  private async scheduleAlarm(at: number) {
    const current = await this.ctx.storage.getAlarm();
    if (current === null || at < current) {
      await this.ctx.storage.setAlarm(at);
    }
  }

  async computerOperation(value: unknown) {
    return await this.#withActivity(() =>
      withComputerCapacityErrors(() => this.#executeComputerOperation(value))
    );
  }

  async #withActivity<T>(operation: () => Promise<T>): Promise<T> {
    await requireRetainedAccountStorage(this.ctx.storage);
    try {
      return await this.#idle.run(operation);
    } finally {
      if (!(await this.ctx.storage.get(ACCOUNT_ERASED_KEY))) {
        await this.scheduleAlarm(this.#idle.closeAt);
      }
    }
  }

  async #executeComputerOperation(value: unknown) {
    await requireRetainedAccountStorage(this.ctx.storage);
    const request = cloudComputerOperationSchema.parse(value);
    if (request.action === "describe") {
      return describeComputer(
        this.#nativeFiles,
        this.env.BROWSER ? this.describeBrowser("personal") : undefined,
        describeComputerStorage(this.ctx.storage.sql.databaseSize)
      );
    }
    if (request.action === "command") {
      return await this.#executeCommandOperation(request);
    }
    await this.workspace.ready();
    if (request.action === "files") {
      const execute = () =>
        this.#nativeFiles.execute({
          id: crypto.randomUUID(),
          name: request.tool,
          arguments: request.input,
        });
      return {
        kind: "files" as const,
        result: await (["write", "edit", "delete"].includes(request.tool)
          ? this.#files.mutate(execute)
          : execute()),
      };
    }
    if (request.action === "browser") {
      return {
        kind: "browser" as const,
        result: await this.browserTool("personal").execute(
          { code: request.code },
          { messages: [], toolCallId: crypto.randomUUID() }
        ),
      };
    }
    if (request.action === "preview") {
      return {
        kind: "preview" as const,
        result: await this.inspectPreview({
          port: request.port,
          path: request.path,
          expectedText: request.expectedText,
        }),
      };
    }
    return await this.#files.execute(request);
  }

  async #executeCommandOperation(
    request: Extract<CloudComputerOperation, { action: "command" }>
  ) {
    const workingDirectory = posix.resolve(
      `/computer/tasks/${encodeURIComponent(request.invocationId)}`,
      request.cwd ?? "."
    );
    return await createComputerCommandTool({
      context: { submissionId: request.invocationId },
      storage: this.#commands,
      workingDirectory,
      prepareLaunch: async (workspace) => {
        if (
          workingDirectory === "/computer" ||
          workingDirectory.startsWith("/computer/")
        ) {
          await workspace.fs.mkdir(workingDirectory, { recursive: true });
        }
      },
      scheduleCollection: () => this.scheduleAlarm(Date.now() + 15_000),
      assertCanStart: () => this.assertComputerCanStart(request.invocationId),
      workspaceAccess: {
        withWorkspace: async (operation) => {
          using workspace = await getWorkspace(this.workspace);
          return await operation(workspace);
        },
      },
    }).execute(request.command);
  }

  async writeComputerFile(path: string, content: string | Uint8Array) {
    return await this.#withActivity(() =>
      this.#writeComputerFile(path, content)
    );
  }

  async #writeComputerFile(path: string, content: string | Uint8Array) {
    await requireRetainedAccountStorage(this.ctx.storage);
    await withComputerCapacityErrors(async () => {
      await this.workspace.ready();
      await this.#files.write(path, content);
    });
  }

  private async assertComputerCanStart(invocationId: string): Promise<void> {
    await requireRetainedAccountStorage(this.ctx.storage);
    if (
      await this.#commands.get(`computer-invocation-stopped:${invocationId}`)
    ) {
      await requestStoredComputerCleanup({
        context: { submissionId: invocationId },
        storage: this.#commands,
      });
      throw new Error("computer.invocation_stopped");
    }
  }

  async pendingComputerCommands(invocationId: string) {
    await requireRetainedAccountStorage(this.ctx.storage);
    return await listPendingRemoteAgentComputerCommands({
      context: { submissionId: invocationId },
      storage: this.#commands,
    });
  }

  async stopComputerCommands(invocationId: string) {
    return await this.#withActivity(() =>
      this.#stopComputerCommands(invocationId)
    );
  }

  async #stopComputerCommands(invocationId: string) {
    await requireRetainedAccountStorage(this.ctx.storage);
    // Fence delayed/in-flight starts before enumerating receipts. Each launched
    // command also checks its Stop receipt after native dispatch completes.
    await this.#commands.put(
      `computer-invocation-stopped:${invocationId}`,
      true
    );
    await this.scheduleAlarm(Date.now());
    return await stopStoredComputerCommands({
      reportConfirmedLoss: true,
      context: { submissionId: invocationId },
      storage: this.#commands,
      access: () => ({
        withWorkspace: async (operation) => {
          using workspace = await getWorkspace(this.workspace);
          return await operation(workspace);
        },
      }),
    });
  }

  async readComputerInvocation(invocationId: string) {
    await requireRetainedAccountStorage(this.ctx.storage);
    return await readStoredComputerInvocation({
      context: { submissionId: invocationId },
      storage: this.#commands,
    });
  }

  async registerComputerInvocation(value: unknown) {
    await requireRetainedAccountStorage(this.ctx.storage);
    await registerComputerInvocation(this.#commands, value);
  }

  async readComputerRecovery(value: unknown) {
    await requireRetainedAccountStorage(this.ctx.storage);
    return await readComputerRecovery(this.#commands, value);
  }

  async requestComputerCleanup(invocationId: string, resume = false) {
    await requireRetainedAccountStorage(this.ctx.storage);
    // Keep this fence with the receipts. A late launch acknowledgement must
    // still observe Stop after a Worker replacement or a lost RPC response.
    await this.#commands.put(
      `computer-invocation-stopped:${invocationId}`,
      true
    );
    await this.scheduleAlarm(Date.now());
    const state = await requestStoredComputerCleanup({
      context: { submissionId: invocationId },
      storage: this.#commands,
      resume,
    });
    await this.scheduleAlarm(Date.now());
    return state;
  }

  async registerGitTransferGrant(value: unknown): Promise<void> {
    await requireRetainedAccountStorage(this.ctx.storage);
    const grant = remoteAgentGitTransferGrantSchema.parse(value);
    if (
      grant.expiresAtMs <= Date.now() ||
      grant.expiresAtMs > Date.now() + 30 * 60 * 1000 ||
      grant.authorization.effect !== "read" ||
      grant.authorization.sources?.length !== 1 ||
      grant.authorization.sources[0]?.kind !== "plugin_connection" ||
      grant.authorization.sources[0].service !== "github"
    ) {
      throw new Error("github.checkout.invalid_transfer_grant");
    }
    await authorizeGitTransfer(this.env.OPENMELD_CORE_WORKER, grant);
    const key = `${GIT_TRANSFER_GRANT_PREFIX}${grant.operationId}`;
    const previous =
      await this.ctx.storage.get<RemoteAgentGitTransferGrant>(key);
    if (
      previous &&
      (previous.organizationId !== grant.organizationId ||
        previous.requesterUserId !== grant.requesterUserId ||
        previous.connectionScope !== grant.connectionScope ||
        previous.owner !== grant.owner ||
        previous.repo !== grant.repo ||
        previous.scopeKey !== grant.scopeKey ||
        previous.authorization.sources?.[0]?.connectionName !==
          grant.authorization.sources[0].connectionName ||
        previous.authorization.sources?.[0]?.connectionUpdatedAtMs !==
          grant.authorization.sources[0].connectionUpdatedAtMs)
    ) {
      throw new Error("github.checkout.transfer_grant_conflict");
    }
    await this.ctx.storage.put(key, grant);
  }

  async registerPluginConnectionGrant(value: unknown): Promise<void> {
    await requireRetainedAccountStorage(this.ctx.storage);
    const grant = pluginConnectionGrantSchema.parse(value);
    await this.#commands.deleteExpired({
      prefix: "plugin-connection:",
      nowMs: Date.now(),
      limit: 100,
    });
    if (grant.expiresAtMs > Date.now() + 30 * 60 * 1000) {
      throw new Error("plugin.connection_lifetime_invalid");
    }
    await authorizePluginConnection(this.env.OPENMELD_CORE_WORKER, grant);
    const key = `plugin-connection:${grant.id}`;
    const previous = await this.#commands.get<PluginConnectionGrant>(key);
    if (
      previous &&
      (previous.organizationId !== grant.organizationId ||
        previous.requesterUserId !== grant.requesterUserId ||
        previous.connectionName !== grant.connectionName ||
        previous.connectionUpdatedAtMs !== grant.connectionUpdatedAtMs ||
        previous.service !== grant.service ||
        previous.connectionScope !== grant.connectionScope ||
        previous.authority.kind !== grant.authority.kind)
    ) {
      throw new Error("plugin.connection_key_conflict");
    }
    await this.#commands.putExpiring(key, grant, grant.expiresAtMs);
  }

  private async forwardPluginEgress(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const match = COMPUTER_PLUGIN_PATH.exec(url.pathname);
    const grant = match
      ? await this.#commands.get<PluginConnectionGrant>(
          `plugin-connection:${match[1]}`
        )
      : undefined;
    if (!grant) {
      return new Response(
        "Plugin connection expired. Renew the same connection key.",
        { status: 403 }
      );
    }
    try {
      await authorizePluginConnection(this.env.OPENMELD_CORE_WORKER, grant);
    } catch {
      return new Response(
        "Plugin access is no longer authorized. Review the selected account in Plugins.",
        { status: 403 }
      );
    }
    const response = await forwardPluginConnection({
      request,
      endpoint: `${match?.[2] ?? "/"}${url.search}`,
      service: grant.service,
      connectionName: grant.connectionName,
      connectorExecution: {
        baseUrl: this.env.OPENMELD_CONNECTORS_BASE_URL,
        runtimeToken: this.env.OPEN_CONNECTOR_OPENMELD_RUNTIME_TOKEN,
      },
    });
    try {
      await authorizePluginConnection(this.env.OPENMELD_CORE_WORKER, grant);
    } catch {
      await response.body?.cancel();
      return new Response("Plugin access was revoked.", { status: 403 });
    }
    return response;
  }

  async startGitPackTransfer(
    value: unknown
  ): Promise<RemoteAgentGitPackStatus> {
    await requireRetainedAccountStorage(this.ctx.storage);
    const request = remoteAgentGitPackStartSchema.parse(value);
    if (
      !request.transportDirectory.startsWith("/computer/") ||
      request.transportDirectory
        .split("/")
        .some((part) => part === "." || part === "..")
    ) {
      throw new Error("github.checkout.invalid_transfer_directory");
    }
    const grant = await this.ctx.storage.get<RemoteAgentGitTransferGrant>(
      `${GIT_TRANSFER_GRANT_PREFIX}${request.operationId}`
    );
    if (!grant || grant.expiresAtMs <= Date.now()) {
      throw new Error("github.checkout.transfer_grant_unavailable");
    }
    await authorizeGitTransfer(this.env.OPENMELD_CORE_WORKER, grant);
    const key = `${GIT_PACK_JOB_PREFIX}${request.operationId}`;
    let job = await this.ctx.storage.get<GitPackJob>(key);
    if (
      job &&
      (job.transportDirectory !== request.transportDirectory ||
        job.sourceCommit !== request.sourceCommit ||
        job.sourceTree !== request.sourceTree ||
        job.baselineCommit !== request.baselineCommit ||
        job.baselineTree !== request.baselineTree)
    ) {
      throw new Error("github.checkout.transfer_conflict");
    }
    if (!job) {
      job = {
        ...request,
        status: "pending",
        attempt: 0,
        startedAtMs: null,
        bytes: null,
        errorCode: null,
      };
      await this.ctx.storage.put(key, job);
      await this.scheduleAlarm(Date.now());
    } else if (
      job.status === "running" &&
      job.startedAtMs !== null &&
      Date.now() - job.startedAtMs > GIT_PACK_RETRY_AFTER_MS
    ) {
      await this.scheduleAlarm(Date.now());
    }
    return gitPackStatus(job);
  }

  async alarm(): Promise<void> {
    await requireRetainedAccountStorage(this.ctx.storage);
    // Rearm before external I/O so a Worker replacement cannot abandon receipts.
    await this.scheduleAlarm(Date.now() + 15_000);
    await collectComputerCommands({
      storage: this.#commands,
      assertCanStart: (invocationId) =>
        this.assertComputerCanStart(invocationId),
      workspaceAccess: {
        withWorkspace: async (operation) => {
          using workspace = await getWorkspace(this.workspace);
          return await operation(workspace);
        },
      },
    });
    // Pack downloads can take minutes. Keep them out of the alarm handler so
    // they cannot block command receipts past the native retention window.
    this.ctx.waitUntil(this.collectGitPack());
    using workspace = await getWorkspace(this.workspace);
    const maintenanceRevision = this.#maintenanceRevision;
    const hasSyncMaintenance = await workspace.maintainSync();
    await this.ctx.blockConcurrencyWhile(async () => {
      const jobs = await this.ctx.storage.list<GitPackJob>({
        prefix: GIT_PACK_JOB_PREFIX,
      });
      const nextCommandAt = await this.#commands.nextCollectionAt();
      const hasGitWork = [...jobs.values()].some(
        (job) => job.status === "pending" || job.status === "running"
      );
      const hasMaintenance =
        hasSyncMaintenance || maintenanceRevision !== this.#maintenanceRevision;
      if (nextCommandAt === null && !hasGitWork && !hasMaintenance) {
        if (this.#commands.hasUnfinishedCommands()) {
          // Paused/uncertain receipts are not permission to terminate work.
          await this.ctx.storage.setAlarm(
            Date.now() + ComputerIdleGuard.graceMs
          );
        } else if (this.#idle.canClose) {
          // Release the SDK heartbeat and WebSocket. The platform can then
          // suspend the idle container. Durable files and receipts stay intact.
          await this.workspace.close();
          await this.ctx.storage.deleteAlarm();
        } else {
          await this.ctx.storage.setAlarm(
            Math.max(Date.now() + ComputerIdleGuard.graceMs, this.#idle.closeAt)
          );
        }
      } else {
        await this.ctx.storage.setAlarm(
          Math.max(
            Date.now() + 100,
            Math.min(
              nextCommandAt ?? Number.POSITIVE_INFINITY,
              hasMaintenance ? Date.now() + 250 : Number.POSITIVE_INFINITY,
              hasGitWork ? Date.now() + 15_000 : Number.POSITIVE_INFINITY
            )
          )
        );
      }
    });
  }

  private async collectGitPack(): Promise<void> {
    const jobs = await this.ctx.storage.list<GitPackJob>({
      prefix: GIT_PACK_JOB_PREFIX,
    });
    const selected = [...jobs.entries()].find(
      ([, job]) =>
        job.status === "pending" ||
        (job.status === "running" &&
          job.startedAtMs !== null &&
          Date.now() - job.startedAtMs > GIT_PACK_RETRY_AFTER_MS)
    );
    if (!selected) {
      return;
    }
    const [key, old] = selected;
    const grant = await this.ctx.storage.get<RemoteAgentGitTransferGrant>(
      `${GIT_TRANSFER_GRANT_PREFIX}${old.operationId}`
    );
    if (!grant || grant.expiresAtMs <= Date.now() || old.attempt >= 3) {
      await this.ctx.storage.put(key, {
        ...old,
        status: "failed",
        errorCode: "github.checkout.git_transfer_unavailable",
      } satisfies GitPackJob);
      return;
    }
    const startedAtMs = Date.now();
    const job: GitPackJob = {
      ...old,
      status: "running",
      attempt: old.attempt + 1,
      startedAtMs,
      bytes: null,
      errorCode: null,
    };
    await this.ctx.storage.put(key, job);
    await this.scheduleAlarm(Date.now() + GIT_PACK_RETRY_AFTER_MS);
    const path = gitPackPath(job);
    try {
      await authorizeGitTransfer(this.env.OPENMELD_CORE_WORKER, grant);
      const virtualUrl = `https://git.openmeld.invalid/${job.operationId}/${grant.owner}/${grant.repo}.git/git-upload-pack`;
      const response = await this.forwardComputerEgress(
        new Request(virtualUrl, {
          method: "POST",
          headers: { "content-type": "application/x-git-upload-pack-request" },
          body: new Blob([
            new Uint8Array(
              gitUploadPackRequest([job.sourceCommit, job.baselineCommit])
            ),
          ]),
          signal: AbortSignal.timeout(12 * 60 * 1000),
        })
      );
      if (!(response.ok && response.body)) {
        await response.body?.cancel();
        throw new Error("github.checkout.git_upstream_unavailable");
      }
      let bytes = 0;
      await this.workspace.fs.mkdir(job.transportDirectory, {
        recursive: true,
      });
      await this.workspace.fs.writeFile(
        path,
        gitUploadPackBytes(response.body, (count) => {
          bytes = count;
        })
      );
      const current = await this.ctx.storage.get<GitPackJob>(key);
      if (current?.attempt === job.attempt) {
        await this.ctx.storage.put(key, {
          ...job,
          status: "available",
          bytes,
        } satisfies GitPackJob);
      }
      console.info("[remote_agent.git_pack_received]", {
        operationId: job.operationId,
        bytes,
        durationMs: Date.now() - startedAtMs,
      });
    } catch (error) {
      await this.workspace.fs.rm(path, { force: true }).catch(() => undefined);
      const current = await this.ctx.storage.get<GitPackJob>(key);
      if (current?.attempt === job.attempt) {
        await this.ctx.storage.put(key, {
          ...job,
          status: job.attempt >= 3 ? "failed" : "pending",
          errorCode:
            error instanceof Error &&
            error.message.startsWith("github.checkout.")
              ? error.message
              : "github.checkout.git_transfer_failed",
        } satisfies GitPackJob);
      }
    } finally {
      const pending = await this.ctx.storage.list<GitPackJob>({
        prefix: GIT_PACK_JOB_PREFIX,
      });
      if (
        [...pending.values()].some(
          (candidate) => candidate.status === "pending"
        )
      ) {
        await this.scheduleAlarm(Date.now());
      }
    }
  }

  private async forwardComputerEgress(request: Request): Promise<Response> {
    const route = parseGitEgressRoute(request);
    if (route instanceof Response) {
      return route;
    }
    const { operationId, owner, repo, endpoint } = route;
    const grant = await this.ctx.storage.get<RemoteAgentGitTransferGrant>(
      `${GIT_TRANSFER_GRANT_PREFIX}${operationId}`
    );
    if (
      !grant ||
      grant.expiresAtMs <= Date.now() ||
      grant.owner !== owner ||
      grant.repo !== repo
    ) {
      return new Response("Git transfer grant is unavailable.", {
        status: 403,
      });
    }
    let selected: Awaited<ReturnType<typeof authorizeGitTransfer>>;
    try {
      selected = await authorizeGitTransfer(
        this.env.OPENMELD_CORE_WORKER,
        grant
      );
    } catch {
      return new Response("Git transfer authorization expired.", {
        status: 403,
      });
    }
    const response = await forwardGitConnectionRequest({
      request,
      endpoint: endpoint as "info/refs" | "git-upload-pack",
      owner,
      repo,
      operationId,
      organizationId: grant.organizationId,
      requesterUserId: grant.requesterUserId,
      connection: selected.connection,
      authorize: () =>
        authorizeGitTransfer(this.env.OPENMELD_CORE_WORKER, grant),
      connectorExecution: {
        baseUrl: this.env.OPENMELD_CONNECTORS_BASE_URL,
        runtimeToken: this.env.OPEN_CONNECTOR_OPENMELD_RUNTIME_TOKEN,
      },
    });
    if (!(response.ok && response.body)) {
      await response.body?.cancel();
      return new Response("Git transfer failed.", {
        status: response.status === 403 ? 403 : 502,
      });
    }
    return new Response(
      observeGitStream(response.body, { operationId, direction: "download" }),
      {
        status: response.status,
        headers: {
          "content-type":
            response.headers.get("content-type") ?? "application/octet-stream",
          "cache-control": "no-store",
        },
      }
    );
  }

  private browserTool(spaceId: string) {
    if (!(this.env.BROWSER && spaceId)) {
      throw new Error(
        "The Computer browser requires its binding and current Space."
      );
    }
    const tools = createBrowserTools({
      ctx: this.ctx,
      loader: this.env.LOADER,
      browser: this.env.BROWSER,
      name: "agent-browser",
      session: { mode: "one-shot" },
      quickActions: false,
      timeout: 30_000,
    });
    const tool = tools.browser_execute;
    if (!(tool?.execute && tool.description)) {
      throw new Error("The Computer browser tool is unavailable.");
    }
    return { description: tool.description, execute: tool.execute };
  }

  describeBrowser(spaceId: string): string {
    return this.browserTool(spaceId).description;
  }

  async executeBrowser(input: unknown): Promise<unknown> {
    await requireRetainedAccountStorage(this.ctx.storage);
    const { spaceId, code } = agentComputerBrowserRequestSchema.parse(input);
    return await this.browserTool(spaceId).execute(
      { code },
      {
        messages: [],
        toolCallId: crypto.randomUUID(),
      }
    );
  }

  async inspectPreview(input: {
    expectedText: string;
    path: string;
    port: number;
  }) {
    return await this.#withActivity(() => this.#inspectPreview(input));
  }

  async #inspectPreview(input: {
    expectedText: string;
    path: string;
    port: number;
  }) {
    await requireRetainedAccountStorage(this.ctx.storage);
    if (!this.env.BROWSER) {
      throw new Error("The Computer browser binding is unavailable.");
    }
    const parsed = agentComputerPreviewRequestSchema.safeParse(input);
    if (!parsed.success) {
      throw new Error("The Computer preview request is invalid.");
    }
    return await inspectComputerPreview({
      ...parsed.data,
      browser: this.env.BROWSER as unknown as PreviewBrowserBinding,
      computerId: this.ctx.id.toString(),
      ctx: this.ctx,
    });
  }

  readonly #containerBackend = new LegacyContainerBackend({
    container: () => this,
    // Preserve the native Computer's existing public-network capability.
    egress: { mode: "direct" },
    // The backend defaults MOUNT_POINT to /workspace; our tree lives
    // under /computer, so pin the FUSE mount there for same-path
    // fidelity between the isolate and the container.
    containerEnv: AGENT_COMPUTER_CONTAINER_ENV,
    id: AGENT_COMPUTER_CONTAINER_BACKEND_ID,
    workspace: workspaceRef(this.ctx),
  });

  readonly workspace = new Workspace({
    backends: [
      new WorkerShellBackend({
        // Both isolate engines share the same files and public network access.
        egress: { mode: "direct" },
        commands: [
          curlModules,
          fileModules,
          htmlToMarkdownModules,
          jqModules,
          jsExecModules,
          pythonModules,
          sqliteModules,
          xanModules,
          yqModules,
        ],
        ctx: this.ctx,
        id: AGENT_COMPUTER_SHELL_BACKEND_ID,
        loader: (this.env as AgentComputerEnv).LOADER as never,
        workspace: workspaceRef(this.ctx),
      }),
      new WorkerJavaScriptBackend({
        id: "worker-javascript",
        loader: this.env.LOADER as never,
        root: "/computer",
        egress: { mode: "direct" },
        modules: {
          "ws:git": createGitModule({ allowNetwork: true }),
          "ws:artifacts": createArtifactsModule(),
        },
        defaultTimeoutMs: 300_000,
        maxTimeoutMs: 3_600_000,
      }),
      this.#containerBackend,
    ],
    sessionId: this.ctx.id.toString(),
    syncTelemetryEnabled: true,
    onMaintenanceNeeded: () => this.requestWorkspaceMaintenance(),
    storageCapacityBytes: AGENT_COMPUTER_STORAGE_CAPACITY_BYTES,
    storage: this.ctx.storage,
  });
  readonly #files = new ComputerFiles(this.workspace.fs);
  readonly #nativeFiles = createComputerFileTools(this.workspace);

  /** WorkspaceProxy forwards the container's outbound /api egress here. */
  override async fetch(request: Request): Promise<Response> {
    await requireRetainedAccountStorage(this.ctx.storage);
    const url = new URL(request.url);
    if (COMPUTER_PLUGIN_PATH.test(url.pathname)) {
      return await this.forwardPluginEgress(request);
    }
    if (COMPUTER_GIT_PATH.test(url.pathname)) {
      return await this.forwardComputerEgress(request);
    }
    if (url.pathname === "/api") {
      return await this.#containerBackend.handleFetch(request);
    }
    const preview = COMPUTER_PREVIEW_PATH.exec(url.pathname);
    if (preview) {
      return await this.#withActivity(() =>
        this.#fetchPreview(request, preview, url)
      );
    }
    return new Response("not found", { status: 404 });
  }

  async #fetchPreview(request: Request, preview: RegExpExecArray, url: URL) {
    const port = Number(preview[1]);
    validateComputerPreviewPort(port);
    if (!(request.method === "GET" || request.method === "HEAD")) {
      return new Response("method not allowed", { status: 405 });
    }
    const headers = new Headers(request.headers);
    headers.delete("host");
    return await this.getWorkspaceContainer().fetchPort(
      port,
      `http://container${preview[2] ?? "/"}${url.search}`,
      { method: request.method, headers, signal: AbortSignal.timeout(15_000) }
    );
  }

  /**
   * Typed RPC door for `getWorkspace(stub)` callers: the worker-shell
   * isolate's WorkspaceServiceProxy and the Flue adapter land here.
   * The container's WorkspaceProxy uses fetch and does not acquire this client.
   */
  async __getWorkspaceStub(): Promise<WorkspaceStub> {
    await requireRetainedAccountStorage(this.ctx.storage);
    const release = this.#idle.acquire();
    try {
      await this.scheduleAlarm(this.#idle.closeAt);
      await this.workspace.ready();
      return new ActiveWorkspaceStub(this.workspace, release);
    } catch (error) {
      release();
      throw error;
    }
  }
}
