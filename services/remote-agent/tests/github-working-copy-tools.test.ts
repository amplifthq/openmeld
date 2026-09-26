import { createHash } from "node:crypto";
import {
  centerAgentConnectorConnectionSelectionSchema,
  centerAgentReadConnectorActionOperationResponseSchema,
  centerAgentRecordConnectorActionOperationResponseSchema,
  remoteAgentGitNativeResultSchema,
} from "@openmeld/schemas";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createRemoteAgentCallbackContext,
  putRemoteAgentCallbackContext,
  type RemoteAgentCoreWorkerBinding,
} from "../agent-core/callback-context";
import { GitWorkingCopyComputer } from "../flue-adapter/github-working-copy-computer";
import {
  checkoutRepository,
  publishCheckout,
} from "../flue-adapter/github-working-copy-tools";
import { executionAccessFixture } from "./execution-access-fixture";
import {
  createRoutineTurnEnvelope,
  createSubmitTurnRequest,
  TEST_NOW_MS,
} from "./fixtures";
import { InMemoryDurableObjectStorage } from "./storage";

const SOURCE_COMMIT = "a".repeat(40);
const LOCAL_COMMIT = "b".repeat(40);
const REMOTE_COMMIT = "c".repeat(40);
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const bytes = Buffer.from("one changed file\n");
const BLOB = createHash("sha1")
  .update(`blob ${bytes.length}\0`)
  .update(bytes)
  .digest("hex");
const treeBytes = Buffer.concat([
  Buffer.from("100644 change.txt\0"),
  Buffer.from(BLOB, "hex"),
]);
const TREE = createHash("sha1")
  .update(`tree ${treeBytes.length}\0`)
  .update(treeBytes)
  .digest("hex");
const intent = {
  key: "task-one",
  owner: "acme",
  repo: "private",
  ref: "main",
  githubActor: "organization" as const,
};
const publish = {
  key: intent.key,
  localCommit: LOCAL_COMMIT,
  expectedRemoteHead: SOURCE_COMMIT,
  operationId: "publish-one",
  message: "One tested change",
};
const CONNECTION_NAME = "org_aaaaaaaaaaaaaaaaaa__shared__github";

async function fixture(
  options: {
    loseResponse?: boolean;
    denyWrite?: boolean;
    routine?: boolean;
  } = {}
) {
  const request = createSubmitTurnRequest(
    options.routine
      ? {
          turnEnvelope: createRoutineTurnEnvelope({
            externalActionPolicy: "read_only",
          }),
        }
      : {}
  );
  const context = createRemoteAgentCallbackContext({
    request,
    nowMs: TEST_NOW_MS,
    ack: {
      accepted: true,
      createdAt: TEST_NOW_MS,
      idempotencyKey: request.idempotencyKey,
      requestId: "git-execution",
      submissionId: "git-execution",
      status: "pending",
    },
  });
  const storage = new InMemoryDurableObjectStorage();
  await putRemoteAgentCallbackContext(storage, context);
  const authorizeBase = executionAccessFixture(context);
  const authorize = vi.fn(async (input: unknown) => {
    if (
      options.denyWrite &&
      (input as { effect?: string }).effect === "write"
    ) {
      throw new Error("write_denied");
    }
    return await authorizeBase(input);
  });
  const connections = vi.fn(async () =>
    centerAgentConnectorConnectionSelectionSchema.parse({
      connection: {
        canDisconnect: false,
        connectionName: CONNECTION_NAME,
        createdAtMs: TEST_NOW_MS,
        disconnectedAtMs: null,
        organizationId: request.organizationId,
        ownerDisplayName: "Fixture installer",
        scope: "shared",
        service: "github",
        status: "active",
        updatedAtMs: TEST_NOW_MS,
        userId: "user_1",
      },
      selection: "shared",
      permission: "write",
    })
  );
  type Operation = {
    signature: string;
    status: "pending" | "completed" | "failed" | "outcome_unknown";
    providerExecutionId: string | null;
  };
  const operations = new Map<string, Operation>();
  const coreWorker: RemoteAgentCoreWorkerBinding = {
    authorizeRemoteAgentExecutionAccess: authorize,
    centerAgentResolveConnectorConnection: connections,
    centerAgentReadConnectorActionOperation: async (value) => {
      const stored = await Promise.resolve(operations.get(value.operationId));
      return centerAgentReadConnectorActionOperationResponseSchema.parse({
        operation: stored
          ? {
              actionId: value.actionId,
              operationId: value.operationId,
              connectionName: CONNECTION_NAME,
              service: "github",
              status: stored.status,
              executionConnection: null,
            }
          : null,
      });
    },
    centerAgentRecordConnectorActionOperation: async (value) => {
      const existing = await Promise.resolve(operations.get(value.operationId));
      if (existing && existing.signature !== value.requestSignature) {
        throw new Error("operation_conflict");
      }
      const operation = existing ?? {
        signature: value.requestSignature,
        status: "pending" as const,
        providerExecutionId: null,
      };
      if (value.outcome !== "attempted") {
        operation.status = value.outcome;
        operation.providerExecutionId = value.providerExecutionId;
      }
      operations.set(value.operationId, operation);
      return centerAgentRecordConnectorActionOperationResponseSchema.parse({
        attribution: {
          actorProfileId: request.agentProfileId,
          onBehalfOf: null,
        },
        executionConnection: null,
        operationId: value.operationId,
        providerExecutionId: operation.providerExecutionId,
        recorded: true,
        replayed: Boolean(existing),
        status: operation.status,
      });
    },
  };
  const state = {
    head: null as string | null,
    branch: "",
    writes: 0,
    lost: false,
  };
  const fetchMock = vi.fn<typeof fetch>(async (_url, init) => {
    const body = (await new Response(init?.body).json()) as {
      endpoint: string;
      method: string;
      body?: Record<string, unknown>;
    };
    const endpoint = body.endpoint.slice("/repos/acme/private".length);
    let data: unknown;
    let status = 200;
    if (endpoint === "") {
      data = { id: 123, full_name: "acme/private", default_branch: "main" };
    } else if (endpoint.startsWith("/commits/")) {
      data = { sha: SOURCE_COMMIT, commit: { tree: { sha: EMPTY_TREE } } };
    } else if (endpoint.startsWith("/git/trees/")) {
      data = { sha: EMPTY_TREE, truncated: false, tree: [] };
    } else if (endpoint.startsWith("/git/ref/")) {
      state.branch = decodeURIComponent(
        endpoint.slice("/git/ref/heads/".length)
      );
      data = state.head
        ? {
            ref: `refs/heads/${state.branch}`,
            object: { type: "commit", sha: state.head },
          }
        : {};
      status = state.head ? 200 : 404;
    } else if (endpoint === "/git/blobs") {
      data = { sha: BLOB };
    } else if (endpoint === "/git/trees") {
      data = { sha: TREE };
    } else if (endpoint === "/git/commits") {
      data = { sha: REMOTE_COMMIT, tree: { sha: TREE } };
    } else if (
      endpoint === "/git/refs" ||
      endpoint.startsWith("/git/refs/heads/")
    ) {
      state.writes += 1;
      state.head = String(body.body?.sha);
      if (options.loseResponse && !state.lost) {
        state.lost = true;
        throw new Error("connection lost after branch update");
      }
      data = {
        ref: `refs/heads/${state.branch}`,
        object: { type: "commit", sha: state.head },
      };
    } else {
      throw new Error(`Unexpected provider endpoint: ${endpoint}`);
    }
    return Response.json({
      success: true,
      message: "OK",
      data: { status, headers: {}, data },
    });
  });
  vi.spyOn(GitWorkingCopyComputer.prototype, "writeManifest").mockResolvedValue(
    undefined
  );
  vi.spyOn(GitWorkingCopyComputer.prototype, "prepare").mockResolvedValue(
    remoteAgentGitNativeResultSchema.parse({
      ready: true,
      localCommit: SOURCE_COMMIT,
      tree: EMPTY_TREE,
      missing: [],
      remaining: 0,
    })
  );
  vi.spyOn(GitWorkingCopyComputer.prototype, "snapshot").mockResolvedValue(
    remoteAgentGitNativeResultSchema.parse({
      localCommit: LOCAL_COMMIT,
      tree: TREE,
      entries: [
        { path: "change.txt", mode: "100644", type: "blob", sha: BLOB },
      ],
    })
  );
  vi.spyOn(GitWorkingCopyComputer.prototype, "blob").mockResolvedValue(bytes);
  const deps = {
    context,
    storage,
    coreWorker,
    workingDirectory: "/workspace",
    connectorExecution: {
      baseUrl: "https://connectors.example",
      runtimeToken: "runtime-secret",
      fetch: fetchMock,
    },
    computer: {
      exec: vi.fn(),
      readFile: vi.fn(),
      writeFile: vi.fn(),
      rm: vi.fn(),
    },
  };
  await checkoutRepository(deps, intent);
  return { deps, state, fetchMock, connections, authorize, operations };
}

afterEach(() => vi.restoreAllMocks());
describe("bounded Git publication and receipts", () => {
  it("publishes the immutable tree to the fixed task branch and reuses its receipt on retry", async () => {
    const f = await fixture();
    const result = await publishCheckout(f.deps, publish);
    expect(result).toMatchObject({
      status: "completed",
      commit: REMOTE_COMMIT,
      tree: TREE,
      localCommit: LOCAL_COMMIT,
      replayed: false,
    });
    expect(f.state.writes).toBe(1);
    expect(await publishCheckout(f.deps, publish)).toMatchObject({
      status: "completed",
      commit: REMOTE_COMMIT,
      replayed: true,
    });
    expect(f.state.writes).toBe(1);
  });
  it("allows concurrent identical publication calls to update the branch at most once", async () => {
    const f = await fixture();
    const results = await Promise.all([
      publishCheckout(f.deps, publish),
      publishCheckout(f.deps, publish),
    ]);
    expect(results.some((result) => result.status === "completed")).toBe(true);
    expect(f.state.writes).toBe(1);
    expect(await publishCheckout(f.deps, publish)).toMatchObject({
      status: "completed",
      replayed: true,
    });
  });

  it("does not publish after cancellation", async () => {
    const f = await fixture();
    const stop = new AbortController();
    stop.abort(new Error("cancelled"));
    await expect(publishCheckout(f.deps, publish, stop.signal)).rejects.toThrow(
      "cancelled"
    );
    expect(f.state.writes).toBe(0);
  });

  it("reconciles a lost successful ref response rather than writing a second time", async () => {
    const f = await fixture({ loseResponse: true });
    await expect(publishCheckout(f.deps, publish)).rejects.toThrow(
      "outcome_unknown"
    );
    expect(f.state.writes).toBe(1);
    expect(await publishCheckout(f.deps, publish)).toMatchObject({
      status: "completed",
      replayed: true,
    });
    expect(f.state.writes).toBe(1);
  });
  it("keeps an unknown ref outcome unknown when another commit is now present", async () => {
    const f = await fixture({ loseResponse: true });
    await expect(publishCheckout(f.deps, publish)).rejects.toThrow(
      "outcome_unknown"
    );
    f.state.head = "d".repeat(40);
    expect(await publishCheckout(f.deps, publish)).toMatchObject({
      status: "outcome_unknown",
    });
    expect(f.state.writes).toBe(1);
  });
  it("does not overwrite a task branch that moved from the expected parent", async () => {
    const f = await fixture();
    f.state.head = "d".repeat(40);
    await expect(publishCheckout(f.deps, publish)).rejects.toThrow(
      "branch_changed"
    );
    expect(f.state.writes).toBe(0);
  });
  it("checks write permission even when checkout was allowed", async () => {
    const f = await fixture({ denyWrite: true });
    await expect(publishCheckout(f.deps, publish)).rejects.toThrow(
      "write_denied"
    );
    expect(f.state.writes).toBe(0);
  });
  it("rejects repurposed checkout and operation identities", async () => {
    const f = await fixture();
    await expect(
      checkoutRepository(f.deps, { ...intent, repo: "different" })
    ).rejects.toThrow("key_conflict");
    await publishCheckout(f.deps, publish);
    await expect(
      publishCheckout(f.deps, { ...publish, message: "different intention" })
    ).rejects.toThrow("operation_conflict");
    expect(f.state.writes).toBe(1);
  });
  it("preserves the read-only Routine policy", async () => {
    const f = await fixture({ routine: true });
    expect(await publishCheckout(f.deps, publish)).toMatchObject({
      sideEffects: 0,
    });
    expect(f.state.writes).toBe(0);
  });
  it("never changes the selected Plugin identity during continuation", async () => {
    const f = await fixture();
    await publishCheckout(f.deps, publish);
    expect(f.connections).toHaveBeenCalledTimes(1);
    for (const [, init] of f.fetchMock.mock.calls) {
      expect(new Headers(init?.headers).get("x-oo-connector-alias")).toBe(
        CONNECTION_NAME
      );
    }
  });
});
