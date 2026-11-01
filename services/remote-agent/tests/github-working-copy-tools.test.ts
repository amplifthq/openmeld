import { createHash } from "node:crypto";
import type { WorkspaceClient } from "@cloudflare/computer";
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
import { getRemoteAgentGitHubToolDefinitions } from "../agent-core/github-tools";
import {
  GitHubWorkingCopyProvider,
  gitBlobSha,
} from "../connectors/github-working-copy-provider";
import { rankRemoteAgentCapabilities } from "../flue-adapter/capability-catalog";
import { GitWorkingCopyComputer } from "../flue-adapter/github-working-copy-computer";
import {
  checkoutRepository,
  getGitHubWorkingCopyTools,
  publishCheckout,
  publishComputerFile,
} from "../flue-adapter/github-working-copy-tools";
import { executionAccessFixture } from "./execution-access-fixture";
import {
  createRoutineTurnEnvelope,
  createSubmitTurnRequest,
  TEST_NOW_MS,
} from "./fixtures";
import { selectedRepositoryWorkTarget } from "./fixtures/work-target";
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
const TASK_BRANCH_PREFIX_PATTERN = /^openmeld\/work-/u;

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
    centerAgentWorkTarget: async () =>
      selectedRepositoryWorkTarget(context, { owner: "acme", repo: "private" }),
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
        executionAllowed: !existing && value.outcome === "attempted",
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
    } else if (endpoint === "/git/ref/heads/main") {
      data = {
        ref: "refs/heads/main",
        object: { type: "commit", sha: SOURCE_COMMIT },
      };
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
    workspaceAccess: {
      withWorkspace: () =>
        Promise.reject(
          new Error("No Computer workspace in checkout-only tests")
        ),
    },
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
  it.each([
    "publish image to GitHub branch",
    "upload screenshot to GitHub",
    "把电脑里的图片发到 GitHub 分支",
    "发布一张图到 GitHub 分支",
  ])("finds the hosted image publication entry for %s", (query) => {
    const catalog = [
      ...getRemoteAgentGitHubToolDefinitions({
        coreWorker: {} as never,
        storage: {} as never,
        submissionId: "test",
      }),
      ...getGitHubWorkingCopyTools({} as never),
    ];
    expect(
      rankRemoteAgentCapabilities(catalog, query)
        .slice(0, 8)
        .map(({ capability }) => capability.name)
    ).toContain("github_publish_computer_file");
  });

  it("reuses the verified Computer manifests instead of downloading the tree on retry", async () => {
    const f = await fixture();
    vi.mocked(f.deps.computer.readFile).mockResolvedValue("[]");
    f.fetchMock.mockClear();
    await checkoutRepository(f.deps, intent);
    expect(
      f.fetchMock.mock.calls.filter(([, init]) =>
        JSON.parse(String(init?.body)).endpoint.includes("/git/trees/")
      )
    ).toHaveLength(0);
    expect(f.deps.computer.writeFile).not.toHaveBeenCalled();
  });

  it("resolves the trusted baseline from the authenticated repository default, independently of the requested ref", async () => {
    const f = await fixture();
    const original = f.fetchMock.getMockImplementation();
    if (!original) {
      throw new Error("Missing provider fixture");
    }
    const candidate = "d".repeat(40);
    f.fetchMock.mockClear();
    f.fetchMock.mockImplementation(async (url, init) => {
      const input = JSON.parse(String(init?.body));
      if (input.endpoint === "/repos/acme/private/commits/main") {
        throw new Error(
          "Default branch must not use an ambiguous branch/tag name"
        );
      }
      if (input.endpoint === "/repos/acme/private/commits/feature") {
        return Response.json({
          success: true,
          message: "OK",
          data: {
            status: 200,
            headers: {},
            data: { sha: candidate, commit: { tree: { sha: EMPTY_TREE } } },
          },
        });
      }
      return await original(url, init);
    });
    const result = await checkoutRepository(f.deps, {
      ...intent,
      key: "independent-baseline",
      ref: "feature",
    });
    expect(result).toMatchObject({
      sourceCommit: candidate,
      baseline: {
        sourceCommit: SOURCE_COMMIT,
        branch: "main",
        ref: "refs/remotes/origin/main",
      },
    });
    expect(
      f.fetchMock.mock.calls.some(
        ([, init]) =>
          JSON.parse(String(init?.body)).endpoint ===
          "/repos/acme/private/git/ref/heads/main"
      )
    ).toBe(true);
    expect(
      f.fetchMock.mock.calls.some(
        ([, init]) =>
          JSON.parse(String(init?.body)).endpoint ===
          `/repos/acme/private/commits/${SOURCE_COMMIT}`
      )
    ).toBe(true);
  });

  it.each([
    "d".repeat(40),
    "D".repeat(40),
  ])("rejects a different provider commit when checkout requests exact SHA %s", async (ref) => {
    const f = await fixture();
    vi.mocked(GitWorkingCopyComputer.prototype.writeManifest).mockClear();
    vi.mocked(GitWorkingCopyComputer.prototype.prepare).mockClear();

    await expect(
      checkoutRepository(f.deps, {
        ...intent,
        key: "exact-commit-mismatch",
        ref,
      })
    ).rejects.toThrow("github.checkout.source_commit_mismatch");

    expect(
      GitWorkingCopyComputer.prototype.writeManifest
    ).not.toHaveBeenCalled();
    expect(GitWorkingCopyComputer.prototype.prepare).not.toHaveBeenCalled();
  });

  it("returns preparing with imported progress before the Code Mode deadline", async () => {
    const f = await fixture();
    const contents = [
      bytes,
      ...[2, 3, 4, 5].map((index) => Buffer.from(`file ${index}\n`)),
    ];
    const blobs = contents.map((content) => ({
      bytes: content,
      sha: createHash("sha1")
        .update(`blob ${content.length}\0`)
        .update(content)
        .digest("hex"),
    }));
    const entries = blobs.map(({ bytes: content, sha }, index) => ({
      path: `file-${index}.txt`,
      mode: "100644" as const,
      type: "blob" as const,
      sha,
      size: content.length,
    }));
    vi.spyOn(GitHubWorkingCopyProvider.prototype, "tree").mockResolvedValue(
      entries as never
    );
    const originalFetch = f.fetchMock.getMockImplementation();
    if (!originalFetch) {
      throw new Error("Missing provider fixture");
    }
    let nowMs = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => nowMs);
    f.fetchMock.mockImplementation(async (url, init) => {
      const request = JSON.parse(String(init?.body));
      const blob = blobs.find(({ sha }) =>
        request.endpoint.endsWith(`/git/blobs/${sha}`)
      );
      if (blob) {
        if (blob.sha === BLOB) {
          nowMs += 46_000;
        }
        return Response.json({
          success: true,
          message: "OK",
          data: {
            status: 200,
            headers: {},
            data: {
              sha: blob.sha,
              encoding: "base64",
              content: blob.bytes.toString("base64"),
              size: blob.bytes.length,
            },
          },
        });
      }
      return await originalFetch(url, init);
    });
    vi.mocked(GitWorkingCopyComputer.prototype.prepare)
      .mockResolvedValueOnce({
        ready: false,
        remaining: blobs.length,
        missing: blobs.map(({ sha }) => sha),
      })
      .mockResolvedValueOnce({
        ready: false,
        remaining: 1,
        missing: [blobs[4]?.sha ?? BLOB],
      });
    const result = await checkoutRepository(f.deps, {
      ...intent,
      key: "budget-progress",
    });
    expect(result).toMatchObject({ status: "preparing", remainingBlobs: 1 });
    expect(
      f.fetchMock.mock.calls.filter(([, init]) =>
        JSON.parse(String(init?.body)).endpoint.includes("/git/blobs/")
      )
    ).toHaveLength(4);
    expect(f.deps.computer.writeFile).toHaveBeenCalledTimes(4);
  });

  it("returns preparing when the native preparation exceeds its remaining budget", async () => {
    const f = await fixture();
    vi.mocked(GitWorkingCopyComputer.prototype.prepare).mockRejectedValue(
      new DOMException("Preparation timed out", "TimeoutError")
    );
    vi.mocked(GitWorkingCopyComputer.prototype.prepare).mockClear();
    const result = await checkoutRepository(f.deps, {
      ...intent,
      key: "slow-prepare",
    });
    expect(result).toMatchObject({
      status: "preparing",
      remainingBlobs: null,
    });
    expect(GitWorkingCopyComputer.prototype.prepare).toHaveBeenCalledTimes(2);
    expect(
      vi
        .mocked(GitWorkingCopyComputer.prototype.prepare)
        .mock.calls.every(
          ([, timeoutMs]) =>
            typeof timeoutMs === "number" && timeoutMs <= 55_000
        )
    ).toBe(true);
  });

  it("returns a retryable preparing result when initial repository metadata times out", async () => {
    const f = await fixture();
    const originalFetch = f.fetchMock.getMockImplementation();
    if (!originalFetch) {
      throw new Error("Missing provider fixture");
    }
    let nowMs = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => nowMs);
    f.fetchMock.mockClear();
    f.fetchMock.mockImplementation(async (url, init) => {
      const result = await originalFetch(url, init);
      if (JSON.parse(String(init?.body)).endpoint === "/repos/acme/private") {
        nowMs += 56_000;
      }
      return result;
    });
    const result = await checkoutRepository(f.deps, {
      ...intent,
      key: "slow-metadata",
    });
    expect(result).toMatchObject({
      status: "preparing",
      key: "slow-metadata",
      remainingBlobs: null,
    });
    expect(f.fetchMock).toHaveBeenCalledOnce();
  });

  it("returns preparing instead of failing when every blob request times out", async () => {
    const f = await fixture();
    vi.spyOn(GitHubWorkingCopyProvider.prototype, "tree").mockResolvedValue([
      {
        path: "change.txt",
        mode: "100644",
        type: "blob",
        sha: BLOB,
        size: bytes.length,
      },
    ]);
    vi.spyOn(GitHubWorkingCopyProvider.prototype, "blob").mockRejectedValue(
      new DOMException("Blob timed out", "TimeoutError")
    );
    vi.mocked(GitWorkingCopyComputer.prototype.prepare).mockResolvedValue({
      ready: false,
      remaining: 1,
      missing: [BLOB],
    });
    const result = await checkoutRepository(f.deps, {
      ...intent,
      key: "slow-blob",
    });
    expect(result).toMatchObject({ status: "preparing", remainingBlobs: 1 });
    expect(GitHubWorkingCopyProvider.prototype.blob).toHaveBeenCalledOnce();
  });

  it("rejects 201 new blobs before claiming a write, without leaving a pending receipt", async () => {
    const f = await fixture();
    vi.mocked(GitWorkingCopyComputer.prototype.snapshot).mockResolvedValue({
      localCommit: LOCAL_COMMIT,
      tree: TREE,
      entries: Array.from({ length: 201 }, (_, index) => ({
        path: `file-${index}`,
        type: "blob" as const,
        mode: "100644" as const,
        sha: (index + 1).toString(16).padStart(40, "0"),
      })),
    });
    f.fetchMock.mockClear();
    for (let retry = 0; retry < 2; retry += 1) {
      await expect(publishCheckout(f.deps, publish)).rejects.toThrow(
        "change_too_large"
      );
      expect(f.operations.has(publish.operationId)).toBe(false);
    }
    expect(f.state.writes).toBe(0);
    expect(
      f.fetchMock.mock.calls.every(
        ([, init]) => JSON.parse(String(init?.body)).method === "GET"
      )
    ).toBe(true);
  });

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
    f.deps.coreWorker.centerAgentWorkTarget = async () =>
      selectedRepositoryWorkTarget(f.deps.context, {
        owner: "acme",
        repo: "another-project",
      });
    await expect(
      publishCheckout(f.deps, { ...publish, operationId: "different-goal" })
    ).rejects.toThrow("work_target.destination_mismatch");
    expect(f.state.writes).toBe(1);
  });
  it("allows concurrent identical publication calls to update the branch at most once", async () => {
    const f = await fixture();
    const results = await Promise.allSettled([
      publishCheckout(f.deps, publish),
      publishCheckout(f.deps, publish),
    ]);
    expect(
      results.some(
        (result) =>
          result.status === "fulfilled" && result.value.status === "completed"
      )
    ).toBe(true);
    for (const result of results) {
      if (result.status === "rejected") {
        expect(result.reason.message).toContain("Core has not granted");
      }
    }
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
  it("publishes one bounded Computer image on a side branch and replays without another write", async () => {
    const f = await fixture();
    const image = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1]);
    const imageBlob = await gitBlobSha(image);
    const original = f.fetchMock.getMockImplementation();
    if (!original) {
      throw new Error("Missing provider fixture");
    }
    f.fetchMock.mockImplementation(async (url, init) => {
      const payload = JSON.parse(String(init?.body));
      const endpoint = String(payload.endpoint);
      let response: unknown = null;
      if (endpoint.endsWith("/git/blobs")) {
        response = { sha: imageBlob };
      } else if (endpoint.endsWith("/git/trees")) {
        response = { sha: TREE };
      } else if (endpoint.endsWith("/git/commits")) {
        response = { sha: REMOTE_COMMIT, tree: { sha: TREE } };
      }
      if (response) {
        return Response.json({
          success: true,
          data: { status: 200, headers: {}, data: response },
        });
      }
      return await original(url, init);
    });
    const workspace = {
      fs: {
        lstat: async () => ({
          isSymbolicLink: false,
          isFile: true,
          size: image.byteLength,
        }),
        readFile: async () =>
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(image);
              controller.close();
            },
          }),
      },
    } as unknown as WorkspaceClient;
    const deps = {
      ...f.deps,
      workingDirectory: "/computer/tasks/image-publication",
      workspaceAccess: {
        withWorkspace: async <T>(
          operation: (workspace: WorkspaceClient) => Promise<T>
        ) => await operation(workspace),
      },
    };
    const request = {
      path: "screenshot.png",
      owner: "acme",
      repo: "private",
      githubActor: "organization" as const,
      operationId: "image-one",
    };
    const first = await publishComputerFile(deps, request);
    expect(first).toMatchObject({
      status: "completed",
      branch: expect.stringMatching(TASK_BRANCH_PREFIX_PATTERN),
      path: `openmeld/attachments/${imageBlob}.png`,
      url: `https://github.com/acme/private/blob/${REMOTE_COMMIT}/openmeld/attachments/${imageBlob}.png?raw=true`,
      replayed: false,
    });
    expect(f.state.writes).toBe(1);
    expect(await publishComputerFile(deps, request)).toMatchObject({
      status: "completed",
      replayed: true,
      url: `https://github.com/acme/private/blob/${REMOTE_COMMIT}/openmeld/attachments/${imageBlob}.png?raw=true`,
    });
    expect(f.state.writes).toBe(1);
    const treeCall = f.fetchMock.mock.calls
      .map(([, init]) => JSON.parse(String(init?.body)))
      .find(
        (call) =>
          call.endpoint === "/repos/acme/private/git/trees" &&
          call.body?.base_tree
      );
    expect(treeCall.body.tree).toEqual([
      {
        path: `openmeld/attachments/${imageBlob}.png`,
        mode: "100644",
        type: "blob",
        sha: imageBlob,
      },
    ]);
  });
});
