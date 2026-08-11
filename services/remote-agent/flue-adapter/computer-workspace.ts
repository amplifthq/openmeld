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

/**
 * The Center Agent's computer: an org-level durable workspace backed by
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
const CENTER_AGENT_TASK_CONVERSATION_PREFIX = "center-agent-task:";

/** Root layout of the computer. Prompt conventions reference these. */
export const AGENT_COMPUTER_ROOT = "/computer";
export const AGENT_COMPUTER_LAYOUT_DIRECTORIES = [
  `${AGENT_COMPUTER_ROOT}/org`,
  `${AGENT_COMPUTER_ROOT}/projects`,
  `${AGENT_COMPUTER_ROOT}/spaces`,
  `${AGENT_COMPUTER_ROOT}/tasks`,
  `${AGENT_COMPUTER_ROOT}/routines`,
  `${AGENT_COMPUTER_ROOT}/home`,
] as const;

type AgentComputerEnv = {
  LOADER: unknown;
};

class AgentComputerBase extends DurableObject<AgentComputerEnv> {}

function workspaceRef(ctx: DurableObjectState) {
  return { binding: AGENT_COMPUTER_BINDING, id: ctx.id.toString() };
}

export class AgentComputer extends withWorkspaceContainer(AgentComputerBase) {
  readonly #containerBackend = new CloudflareContainerBackend({
    container: () => this,
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

export function buildAgentComputerTaskDirectory(taskId: string): string {
  return `${AGENT_COMPUTER_ROOT}/tasks/${encodePathIdentity(taskId)}`;
}

export function buildAgentComputerRoutineDirectory(routineId: string): string {
  return `${AGENT_COMPUTER_ROOT}/routines/${encodePathIdentity(routineId)}`;
}

export function resolveAgentComputerWorkingDirectory(input: {
  conversationId?: string | null;
  routineId?: string | null;
  spaceId: string | null;
}): string {
  if (input.conversationId?.startsWith(CENTER_AGENT_TASK_CONVERSATION_PREFIX)) {
    const taskId = input.conversationId.slice(
      CENTER_AGENT_TASK_CONVERSATION_PREFIX.length
    );
    if (!taskId) {
      throw new Error("Center Agent Task Computer identity is empty.");
    }
    return buildAgentComputerTaskDirectory(taskId);
  }
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
