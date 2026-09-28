import { DurableObject } from "cloudflare:workers";
import {
  type DurableObjectStorageLike,
  Workspace,
  type WorkspaceClient,
  type WorkspaceStub,
} from "@cloudflare/computer";
import {
  CloudflareContainerBackend,
  withWorkspaceContainer,
} from "@cloudflare/computer/backends/container";
import { WorkerShellBackend } from "@cloudflare/computer/backends/worker-shell";
import curlModules from "@cloudflare/computer/shell/curl";
import fileModules from "@cloudflare/computer/shell/file";
import htmlToMarkdownModules from "@cloudflare/computer/shell/html-to-markdown";
import jqModules from "@cloudflare/computer/shell/jq";
import jsExecModules from "@cloudflare/computer/shell/js-exec";
import pythonModules from "@cloudflare/computer/shell/python";
import sqliteModules from "@cloudflare/computer/shell/sqlite";
import xanModules from "@cloudflare/computer/shell/xan";
import yqModules from "@cloudflare/computer/shell/yq";
import type { RemoteAgentResultSource } from "@openmeld/schemas";
import {
  agentComputerBrowserRequestSchema,
  agentComputerPreviewRequestSchema,
  type RemoteAgentGitTransferGrant,
  remoteAgentGitTransferGrantSchema,
} from "@openmeld/schemas";
import type { BrowserBinding } from "agents/browser";
import { createBrowserTools } from "agents/browser/ai";
import type { RemoteAgentCoreWorkerBinding } from "../agent-core/callback-context";
import { ComputerDataSourceStore } from "./computer-data-sources";
import {
  inspectComputerPreview,
  type PreviewBrowserBinding,
  validateComputerPreviewPort,
} from "./computer-preview";
import { authorizeGitTransfer } from "./git-transfer-authorization";

/**
 * The hosted Agent's computer: an identity-scoped durable workspace backed by
 * the Durable Object's SQLite storage via `@cloudflare/computer`.
 *
 * Files live in the DO (durable across restarts and independent of any
 * container lifetime). There is exactly one file world with two
 * execution engines over it:
 *
 * - worker-shell (default): just-bash in a Dynamic Worker minted
 *   through `env.LOADER`, reaching this workspace over Workers RPC.
 *   Instant, no container, text tooling only.
 * - container: computerd in a Cloudflare Container, FUSE-mounting this
 *   same workspace at /computer. Full Linux userland (python, git,
 *   real binaries); syncs changes back over capnweb.
 */

export const AGENT_COMPUTER_BINDING = "AGENT_COMPUTER";
export const AGENT_COMPUTER_SHELL_BACKEND_ID = "worker-shell";
export const AGENT_COMPUTER_CONTAINER_BACKEND_ID = "container";
const COMPUTER_PREVIEW_PATH = /^\/__preview\/(\d+)(\/.*)?$/u;

/** Root layout of the computer. Prompt conventions reference these. */
export const AGENT_COMPUTER_ROOT = "/computer";
export const AGENT_COMPUTER_LAYOUT_DIRECTORIES = [
  `${AGENT_COMPUTER_ROOT}/org`,
  `${AGENT_COMPUTER_ROOT}/projects`,
  `${AGENT_COMPUTER_ROOT}/spaces`,
  `${AGENT_COMPUTER_ROOT}/routines`,
  `${AGENT_COMPUTER_ROOT}/home`,
] as const;

type AgentComputerEnv = {
  LOADER: WorkerLoader;
  BROWSER?: BrowserBinding;
  OPENMELD_CORE_WORKER: RemoteAgentCoreWorkerBinding;
  OPENMELD_CONNECTORS_BASE_URL: string;
  OPEN_CONNECTOR_OPENMELD_RUNTIME_TOKEN: string;
};

const GIT_EGRESS_HOST = "git.openmeld.invalid";
const GIT_TRANSFER_GRANT_PREFIX = "openmeld:git-transfer-grant:";
const GIT_EGRESS_PATH =
  /^\/([A-Za-z0-9_-]{1,64})\/([A-Za-z0-9][A-Za-z0-9_.-]{0,99})\/([A-Za-z0-9][A-Za-z0-9_.-]{0,99})\.git\/(info\/refs|git-upload-pack)$/u;

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
  const match = GIT_EGRESS_PATH.exec(target.pathname);
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

function workspaceRef(ctx: DurableObjectState) {
  return { binding: AGENT_COMPUTER_BINDING, id: ctx.id.toString() };
}

export class AgentComputer extends withWorkspaceContainer(AgentComputerBase) {
  // Created before Workspace and never exposed by Workspace.stub().
  readonly #dataSources = new ComputerDataSourceStore(this.ctx.storage);

  async registerGitTransferGrant(value: unknown): Promise<void> {
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
        previous.owner !== grant.owner ||
        previous.repo !== grant.repo ||
        previous.scopeKey !== grant.scopeKey ||
        previous.authorization.submissionId !==
          grant.authorization.submissionId ||
        previous.authorization.sources?.[0]?.connectionName !==
          grant.authorization.sources[0].connectionName ||
        previous.authorization.sources?.[0]?.connectionUpdatedAtMs !==
          grant.authorization.sources[0].connectionUpdatedAtMs)
    ) {
      throw new Error("github.checkout.transfer_grant_conflict");
    }
    await this.ctx.storage.put(key, grant);
  }

  readonly #gitEgressGateway = {
    fetch: async (request: Request) =>
      await this.forwardComputerEgress(request),
  } as Fetcher;

  private async forwardComputerEgress(request: Request): Promise<Response> {
    const target = new URL(request.url);
    if (target.hostname !== GIT_EGRESS_HOST) {
      // Preserve the Computer's existing public network capability.
      return await fetch(request);
    }
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
    try {
      await authorizeGitTransfer(this.env.OPENMELD_CORE_WORKER, grant);
    } catch {
      return new Response("Git transfer authorization expired.", {
        status: 403,
      });
    }
    const base = this.env.OPENMELD_CONNECTORS_BASE_URL;
    const token = this.env.OPEN_CONNECTOR_OPENMELD_RUNTIME_TOKEN;
    if (!(base && token)) {
      return new Response("Git transfer runtime is unavailable.", {
        status: 503,
      });
    }
    const connectorUrl = new URL(
      `/v1/openmeld/git/${owner}/${repo}/${endpoint}`,
      base
    );
    if (endpoint === "info/refs") {
      connectorUrl.search = route.search;
    }
    const headers = new Headers({
      authorization: `Bearer ${token}`,
      "x-openmeld-organization-id": grant.organizationId,
      "x-openmeld-requester-user-id": grant.requesterUserId,
      "x-openmeld-operation-id": operationId,
      "x-openmeld-repository": `${owner}/${repo}`,
    });
    const gitProtocol = request.headers.get("git-protocol");
    if (gitProtocol) {
      headers.set("git-protocol", gitProtocol);
    }
    if (request.method === "POST") {
      headers.set("content-type", "application/x-git-upload-pack-request");
    }
    const uploadBody =
      request.method === "POST" && request.body
        ? observeGitStream(request.body, { operationId, direction: "upload" })
        : undefined;
    const response = await fetch(connectorUrl, {
      method: request.method,
      headers,
      body: uploadBody,
      redirect: "manual",
      signal: request.signal,
      ...(request.method === "POST" ? { duplex: "half" } : {}),
    } as RequestInit);
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

  readDataSources(): Promise<RemoteAgentResultSource[]> {
    return Promise.resolve(this.#dataSources.read());
  }

  recordDataSource(source: RemoteAgentResultSource): Promise<void> {
    this.#dataSources.record(source);
    return Promise.resolve();
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

  readonly #containerBackend = new CloudflareContainerBackend({
    container: () => this,
    // Preserve the native Computer's existing public-network capability.
    egress: { mode: "http-gateway", gateway: this.#gitEgressGateway },
    // The backend defaults MOUNT_POINT to /workspace; our tree lives
    // under /computer, so pin the FUSE mount there for same-path
    // fidelity between the isolate and the container.
    containerEnv: { MOUNT_POINT: AGENT_COMPUTER_ROOT },
    id: AGENT_COMPUTER_CONTAINER_BACKEND_ID,
    workspace: workspaceRef(this.ctx),
  });

  readonly workspace = new Workspace({
    backends: [
      new WorkerShellBackend({
        // SDK 0.2 makes previously bundled commands opt-in. Preserve the
        // existing tool surface; worker-shell network access remains disabled.
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
      this.#containerBackend,
    ],
    sessionId: this.ctx.id.toString(),
    storage: this.ctx.storage as unknown as DurableObjectStorageLike,
  });

  /** WorkspaceProxy forwards the container's outbound /ws egress here. */
  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/ws") {
      return await this.#containerBackend.handleFetch(request);
    }
    const preview = COMPUTER_PREVIEW_PATH.exec(url.pathname);
    if (preview) {
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
    return new Response("not found", { status: 404 });
  }

  /**
   * Typed RPC door for `getWorkspace(stub)` callers: the worker-shell
   * isolate's WorkspaceServiceProxy, the container's WorkspaceProxy
   * egress, and the Flue adapter all land here.
   */
  async __getWorkspaceStub(): Promise<WorkspaceStub> {
    await this.workspace.ready();
    return this.workspace.stub();
  }
}

export function buildAgentComputerSpaceDirectory(spaceId: string): string {
  return `${AGENT_COMPUTER_ROOT}/spaces/${spaceId}`;
}

export function buildAgentComputerRoutineDirectory(routineId: string): string {
  return `${AGENT_COMPUTER_ROOT}/routines/${encodePathIdentity(routineId)}`;
}

export function resolveAgentComputerWorkingDirectory(input: {
  conversationId?: string | null;
  routineId?: string | null;
  spaceId: string | null;
}): string {
  if (input.routineId) {
    return buildAgentComputerRoutineDirectory(input.routineId);
  }
  return input.spaceId
    ? buildAgentComputerSpaceDirectory(input.spaceId)
    : `${AGENT_COMPUTER_ROOT}/home`;
}

/**
 * Idempotently create the computer's base layout plus the working
 * directory for the current conversation.
 */
export async function ensureAgentComputerLayout(
  workspace: Pick<WorkspaceClient, "fs">,
  input: {
    conversationId?: string | null;
    routineId?: string | null;
    spaceId: string | null;
  }
): Promise<{ workingDirectory: string }> {
  for (const directory of AGENT_COMPUTER_LAYOUT_DIRECTORIES) {
    await workspace.fs.mkdir(directory, { recursive: true });
  }
  const workingDirectory = resolveAgentComputerWorkingDirectory(input);
  await workspace.fs.mkdir(workingDirectory, { recursive: true });
  return { workingDirectory };
}

function encodePathIdentity(value: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error("Agent Computer directory identity cannot be empty.");
  }
  return encodeURIComponent(normalized);
}
