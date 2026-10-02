import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { WorkspaceClient } from "@cloudflare/computer";
import {
  buildPersonalRemoteAgentConversationId,
  type RemoteAgentGitTransferGrant,
  type RemoteAgentResultSource,
  remoteAgentExecutionAccessRequestSchema,
  remoteAgentExecutionScopeKey,
  resolveRemoteAgentExecutionScope,
} from "@openmeld/schemas";
import type { RemoteAgentWorkerSubmitTurnRequest } from "@openmeld/schemas/types";
import { describe, expect, it, vi } from "vitest";
import {
  createRemoteAgentCallbackContext,
  putRemoteAgentCallbackContext,
} from "../agent-core/callback-context";
import { getRemoteAgentGitHubToolDefinitions } from "../agent-core/github-tools";
import { createRemoteAgentCodeModeFlueTool } from "../flue-adapter/code-mode";
import { authorizeGitTransfer } from "../flue-adapter/git-transfer-authorization";
import { checkoutRepository } from "../flue-adapter/github-working-copy-tools";
import { executeRemoteAgentToolDefinition } from "../flue-adapter/tool-execution";
import { createSubmitTurnRequestV2, TEST_NOW_MS } from "./fixtures";
import { InMemoryDurableObjectStorage } from "./storage";

const CENTER = "agt_00000000-0000-4000-8000-000000000001";
const SHA = "a".repeat(40);
const IDENTITY = {
  delegationId: "delegation-1",
  parentDeliveryId: "parent-1",
  memberId: "member_123",
  userId: "user_1",
  profileId: "22222222-2222-4222-8222-222222222222",
};

async function fixture(actor: "requester" | "organization" = "requester") {
  const base = createSubmitTurnRequestV2();
  const conversationId = buildPersonalRemoteAgentConversationId(base);
  const request: RemoteAgentWorkerSubmitTurnRequest = {
    ...base,
    v: 4,
    conversationId,
    runtimeConversation: { generation: 0, id: conversationId },
    conversationIdentity: {
      kind: "personal_agent",
      agentProfileId: base.agentProfileId,
    },
    spaceDispatchContext: {
      dispatchChainId: "recorded-chain",
      autoRelayDepth: 1,
      visitedProfileIds: [CENTER],
      visitedProfileIdsHash: "hash",
    },
    author: { profileId: CENTER, profileKind: "agent", displayName: "Center" },
    turnEnvelope: {
      ...base.turnEnvelope,
      sender: {
        kind: "agent_profile",
        id: CENTER,
        profileId: CENTER,
        displayName: "Center",
        verified: true,
      },
      trigger: { source: "space_wake" },
    },
  };
  const context = createRemoteAgentCallbackContext({
    request,
    nowMs: TEST_NOW_MS,
    ack: {
      accepted: true,
      createdAt: TEST_NOW_MS,
      idempotencyKey: request.idempotencyKey,
      requestId: "delegated-read",
      submissionId: "delegated-read",
      status: "pending",
    },
  });
  const storage = new InMemoryDurableObjectStorage();
  await putRemoteAgentCallbackContext(storage, context);
  const scope = resolveRemoteAgentExecutionScope(context);
  const connection = {
    canDisconnect: false,
    connectionName: "exact-github",
    createdAtMs: 1,
    disconnectedAtMs: null,
    organizationId: context.organizationId,
    ownerDisplayName: "Felix",
    scope: actor === "requester" ? "member" : "shared",
    service: "github",
    status: "active",
    updatedAtMs: 1,
    userId: "user_1",
  };
  const authorize = vi.fn(async (value: unknown) => {
    const input = value as {
      sources?: Array<{ connectionName: string }>;
      includeDelegatedRequester?: boolean;
    };
    if (
      input.sources?.some(
        (source) => source.connectionName !== connection.connectionName
      )
    ) {
      throw new Error("wrong original connection");
    }
    return await Promise.resolve({
      scope,
      submissionId: context.submissionId,
      ...(input.includeDelegatedRequester
        ? {
            delegatedRequesterSupported: true as const,
            delegatedRequester: IDENTITY,
          }
        : {}),
    });
  });
  const selection = vi.fn(async () => ({
    connection,
    permission: "write",
    selection: actor === "requester" ? "requester" : "shared",
  }));
  const provider = vi.fn<typeof fetch>((url) => {
    const actionId = String(url).split("/v1/actions/")[1];
    return Promise.resolve(
      Response.json({
        success: true,
        message: "OK",
        meta: { actionId, executionId: "provider-read", auditPersisted: true },
        outputSchema: { type: "object", additionalProperties: true },
        data:
          actionId === "github.get_file_contents"
            ? {
                decoded_content: "export const reviewed = true;\n",
                path: "src/main.ts",
                sha: SHA,
                type: "file",
              }
            : {
                sha: SHA,
                number: 42,
                total_count: 0,
                incomplete_results: false,
                items: [],
                files: [],
              },
      })
    );
  });
  const definitions = getRemoteAgentGitHubToolDefinitions({
    storage,
    submissionId: context.submissionId,
    coreWorker: {
      authorizeRemoteAgentExecutionAccess: authorize,
      centerAgentResolveConnectorConnection: selection,
    },
    connectorExecution: {
      baseUrl: "https://connectors.example.test",
      runtimeToken: "synthetic-runtime-secret",
      fetch: provider,
    },
  });
  const invoke = async (
    name: string,
    input: Record<string, unknown>,
    codeMode = false
  ) => {
    const definition = definitions.find((tool) => tool.name === name);
    if (!definition) {
      throw new Error("Missing tool");
    }
    const toolInput = { githubActor: actor, ...input };
    if (!codeMode) {
      return await executeRemoteAgentToolDefinition({
        definition,
        storage,
        submissionId: context.submissionId,
        toolInput,
      });
    }
    const code = await createRemoteAgentCodeModeFlueTool({
      definitions: [definition],
      coreWorker: { authorizeRemoteAgentExecutionAccess: authorize },
      env: {},
      loader: {} as WorkerLoader,
      storage,
      submissionId: context.submissionId,
      runtime: {
        createExecutor: () => ({}),
        createCodeTool: ({ tools }) => ({
          description: "Read the pinned source",
          execute: async () => ({
            result: await tools[name]?.execute?.(toolInput, {
              toolCallId: "delegated-code",
              messages: [],
            }),
          }),
        }),
      },
    });
    return await code.run({
      data: { code: "async () => codemode.read()" },
    } as never);
  };
  return { context, scope, storage, authorize, selection, provider, invoke };
}

function localRepository(root: string) {
  const upstream = join(root, "upstream");
  // Keep Worker credentials out of the process despite the generated ambient ProcessEnv type.
  const env = {
    PATH: process.env.PATH,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_AUTHOR_NAME: "Fixture",
    GIT_AUTHOR_EMAIL: "fixture@example.invalid",
    GIT_COMMITTER_NAME: "Fixture",
    GIT_COMMITTER_EMAIL: "fixture@example.invalid",
  } as unknown as NodeJS.ProcessEnv;
  const git = (directory: string, ...args: string[]) =>
    execFileSync("git", ["-C", directory, ...args], {
      env,
      encoding: "utf8",
    }).trim();
  mkdirSync(upstream);
  git(upstream, "init", "--initial-branch=main");
  writeFileSync(join(upstream, "review.ts"), "export const version = 1;\n");
  git(upstream, "add", ".");
  git(upstream, "commit", "-m", "baseline");
  const baseline = git(upstream, "rev-parse", "HEAD");
  writeFileSync(join(upstream, "review.ts"), "export const version = 2;\n");
  git(upstream, "commit", "-am", "review target");
  const source = git(upstream, "rev-parse", "HEAD");
  const packPath = join(root, "pinned.pack");
  writeFileSync(
    packPath,
    execFileSync(
      "git",
      ["-C", upstream, "pack-objects", "--stdout", "--revs"],
      {
        env,
        input: `${source}\n${baseline}\n`,
      }
    )
  );
  const provider = (endpoint: string) => {
    if (endpoint === "/repos/acme/private") {
      return { id: 1, full_name: "acme/private", default_branch: "main" };
    }
    if (endpoint.endsWith("/git/ref/heads/main")) {
      return {
        ref: "refs/heads/main",
        object: { sha: baseline, type: "commit" },
      };
    }
    if (endpoint.includes("/commits/")) {
      const ref = endpoint.split("/commits/")[1] ?? "";
      return {
        sha: ref,
        commit: { tree: { sha: git(upstream, "rev-parse", `${ref}^{tree}`) } },
      };
    }
    if (endpoint.includes("/git/trees/")) {
      const sha = endpoint.split("/git/trees/")[1] ?? "";
      const tree = git(upstream, "ls-tree", "-r", sha)
        .split("\n")
        .map((line) => {
          const [header, path] = line.split("\t");
          const [mode, type, blob] = (header ?? "").split(" ");
          return {
            mode,
            type,
            sha: blob,
            path,
            size: Number(git(upstream, "cat-file", "-s", blob ?? "")),
          };
        });
      return { sha, tree, truncated: false };
    }
    if (endpoint.includes("/git/blobs/")) {
      const sha = endpoint.split("/git/blobs/")[1] ?? "";
      const bytes = execFileSync(
        "git",
        ["-C", upstream, "cat-file", "blob", sha],
        { env }
      );
      return {
        sha,
        size: bytes.length,
        encoding: "base64",
        content: bytes.toString("base64"),
      };
    }
    throw new Error(`Unexpected read endpoint: ${endpoint}`);
  };
  return { env, git, upstream, source, baseline, packPath, provider };
}

function computerFiles(directory: string): string {
  return readdirSync(directory, { withFileTypes: true })
    .map((entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory()
        ? computerFiles(path)
        : readFileSync(path).toString();
    })
    .join("\n");
}

describe("recorded delegation reaches GitHub reads without impersonating its requester", () => {
  it.each([
    "requester",
    "organization",
  ] as const)("checks out the exact source tree with %s authority and no Computer credentials", async (actor) => {
    const root = mkdtempSync(join(tmpdir(), "openmeld-delegated-checkout-"));
    try {
      const f = await fixture(actor);
      const repository = localRepository(root);
      const workingDirectory = join(root, "computer");
      const commands: string[] = [];
      const exec = async (command: string) => {
        commands.push(command);
        return await Promise.resolve({
          stdout: execFileSync("sh", ["-c", command], {
            env: repository.env,
            encoding: "utf8",
          }),
          stderr: "",
          exitCode: 0,
        });
      };
      const handle = {
        [Symbol.dispose]: () => undefined,
        getReader: () =>
          new ReadableStream({
            start(controller) {
              controller.enqueue({ name: "exit", seq: 1, code: 0 });
              controller.close();
            },
          }).getReader(),
      };
      const workspace = {
        runtime: {
          exec: async (command: string) => {
            await exec(command);
            return handle;
          },
          getExec: async () => await Promise.resolve(handle),
        },
      } as unknown as WorkspaceClient;
      const coreWorker = {
        authorizeRemoteAgentExecutionAccess: f.authorize,
        centerAgentResolveConnectorConnection: f.selection,
      };
      let grant: RemoteAgentGitTransferGrant | undefined;
      const sources: RemoteAgentResultSource[] = [];
      const dependencies = {
        context: f.context,
        storage: f.storage,
        coreWorker,
        workingDirectory,
        connectorExecution: {
          baseUrl: "https://connectors.example.test",
          runtimeToken: "synthetic-runtime-secret",
          fetch: vi.fn<typeof fetch>((_url, init) => {
            const request = JSON.parse(String(init?.body));
            expect(new Headers(init?.headers).get("x-oo-connector-alias")).toBe(
              "exact-github"
            );
            expect(request.method).toBe("GET");
            return Promise.resolve(
              Response.json({
                success: true,
                data: {
                  status: 200,
                  headers: {},
                  data: repository.provider(request.endpoint),
                },
              })
            );
          }),
        },
        computer: {
          writeFile: async (path: string, content: string | Uint8Array) => {
            mkdirSync(dirname(path), { recursive: true });
            await Promise.resolve(writeFileSync(path, content));
          },
          readFile: async (path: string) =>
            await Promise.resolve(readFileSync(path, "utf8")),
          rm: async (path: string) =>
            await Promise.resolve(rmSync(path, { force: true })),
          exec,
        },
        dataSources: {
          readDataSources: async () => await Promise.resolve(sources),
          recordDataSource: async (source: RemoteAgentResultSource) => {
            await Promise.resolve(sources.push(source));
          },
        },
        workspaceAccess: {
          withWorkspace: async <T>(
            run: (value: WorkspaceClient) => Promise<T>
          ) => await run(workspace),
          registerGitTransferGrant: async (
            value: RemoteAgentGitTransferGrant
          ) => {
            await authorizeGitTransfer(coreWorker, value);
            grant = value;
          },
          startGitPackTransfer: async () => {
            if (!grant) {
              throw new Error("Missing host grant");
            }
            await authorizeGitTransfer(coreWorker, grant);
            return {
              status: "available" as const,
              path: repository.packPath,
              bytes: null,
              errorCode: null,
            };
          },
        },
      };
      const intent = {
        key: "pinned-review",
        owner: "acme",
        repo: "private",
        ref: repository.source,
        githubActor: actor,
      };
      let result = await checkoutRepository(dependencies, intent);
      if (result.status !== "ready") {
        result = await checkoutRepository(dependencies, intent);
      }
      expect(result.status).toBe("ready");
      if (!("directory" in result && result.directory)) {
        throw new Error("Checkout directory missing");
      }
      expect(result.sourceCommit).toBe(repository.source);
      expect(repository.git(result.directory, "rev-parse", "HEAD^{tree}")).toBe(
        repository.git(
          repository.upstream,
          "rev-parse",
          `${repository.source}^{tree}`
        )
      );
      expect(readFileSync(join(result.directory, "review.ts"), "utf8")).toBe(
        "export const version = 2;\n"
      );
      expect(repository.git(result.directory, "remote", "-v")).toBe("");
      expect(computerFiles(workingDirectory)).not.toContain(
        "synthetic-runtime-secret"
      );
      expect(commands.join("\n")).not.toContain("synthetic-runtime-secret");
      expect(result.credentialsInComputer).toBe(false);
      if (actor === "requester") {
        expect(grant).toMatchObject({
          requesterUserId: IDENTITY.userId,
          authorization: { includeDelegatedRequester: true },
        });
      }
      f.authorize.mockRejectedValue(
        new Error("remote_agent.delegated_requester_unavailable")
      );
      await expect(checkoutRepository(dependencies, intent)).rejects.toThrow(
        "delegated_requester_unavailable"
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it.each([
    {
      name: "github_get_pull_request",
      input: { owner: "acme", repo: "private", pullNumber: 42 },
    },
    {
      name: "github_list_pull_request_files",
      input: { owner: "acme", repo: "private", pullNumber: 42 },
    },
    {
      name: "github_get_file_contents",
      input: { owner: "acme", repo: "private", path: "src/main.ts", ref: SHA },
    },
    {
      name: "github_get_commit",
      input: { owner: "acme", repo: "private", ref: SHA },
    },
    {
      name: "github_search_code",
      input: { query: "reviewed repo:acme/private" },
    },
  ])("reads $name with the exact personal connection", async ({
    name,
    input,
  }) => {
    const f = await fixture();
    const result = await f.invoke(name, input);
    expect(JSON.stringify(result)).toContain("completed");
    expect(JSON.stringify(result)).not.toContain("synthetic-runtime-secret");
    expect(f.provider).toHaveBeenCalledOnce();
    expect(
      JSON.parse(String(f.provider.mock.calls[0]?.[1]?.body)).connectionName
    ).toBe("exact-github");
    expect(f.scope.principal).toEqual({ kind: "agent", profileId: CENTER });
    expect(f.context.turnEnvelope?.sender).toMatchObject({
      kind: "agent_profile",
      profileId: CENTER,
    });
    expect(f.selection).toHaveBeenCalledWith(
      expect.objectContaining({
        requesterUserId: "user_1",
        connectionPreference: "requester",
        includeDelegatedRequester: true,
      })
    );
    expect(
      f.authorize.mock.calls.filter(
        ([input]) => (input as { sources?: unknown }).sources
      )
    ).toHaveLength(2);
  });

  it.each([
    ["requester", true],
    ["organization", false],
    ["organization", true],
  ] as const)("reads the explicitly chosen %s account through Code Mode=%s", async (actor, codeMode) => {
    const f = await fixture(actor);
    const result = await f.invoke(
      "github_get_file_contents",
      { owner: "acme", repo: "private", path: "src/main.ts", ref: SHA },
      codeMode
    );
    expect(JSON.stringify(result)).toContain("reviewed");
    expect(f.selection).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionPreference: actor === "organization" ? "shared" : "requester",
        requesterUserId: "user_1",
      })
    );
    expect(remoteAgentExecutionScopeKey(f.scope)).toContain(CENTER);
  });

  it.each([
    "revoked",
    "missing_chain",
    "old_core",
    "old_core_strict",
    "wrong_account",
    "other_organization",
  ])("rejects %s before provider access", async (denial) => {
    const f = await fixture();
    if (denial === "revoked") {
      f.authorize.mockRejectedValue(
        new Error("remote_agent.delegated_requester_unavailable")
      );
    } else if (denial === "old_core_strict") {
      f.authorize.mockImplementation(async (value) => {
        await Promise.resolve();
        remoteAgentExecutionAccessRequestSchema
          .omit({ includeDelegatedRequester: true })
          .parse(value);
        throw new Error("Old Core unexpectedly accepted the new field");
      });
    } else if (denial === "missing_chain" || denial === "old_core") {
      f.authorize.mockImplementation(async () => ({
        scope: f.scope,
        submissionId: f.context.submissionId,
        ...(denial === "missing_chain"
          ? { delegatedRequesterSupported: true as const }
          : {}),
      }));
    } else {
      const selection = await f.selection();
      f.selection.mockResolvedValue({
        ...selection,
        connection: {
          ...selection.connection,
          ...(denial === "wrong_account"
            ? { userId: "another-user" }
            : { organizationId: "another-org" }),
        },
      });
    }
    await expect(
      f.invoke("github_get_file_contents", {
        owner: "acme",
        repo: "private",
        path: "src/main.ts",
        ref: SHA,
      })
    ).rejects.toThrow(
      denial.startsWith("old_core") ? "capability_unavailable" : undefined
    );
    expect(f.provider).not.toHaveBeenCalled();
  });

  it("rejects provider writes in a delegated turn", async () => {
    const f = await fixture();
    await expect(
      f.invoke("github_create_issue_comment", {
        owner: "acme",
        repo: "private",
        issueNumber: 42,
        body: "review",
        operationId: "write",
      })
    ).rejects.toThrow("verified Organization member turn");
    expect(f.provider).not.toHaveBeenCalled();
  });

  it("keeps delegated writes denied through Code Mode", async () => {
    const f = await fixture();
    const receipt = await f
      .invoke(
        "github_create_issue_comment",
        {
          owner: "acme",
          repo: "private",
          issueNumber: 42,
          body: "review",
          operationId: "write",
        },
        true
      )
      .then(
        (value) => JSON.stringify(value),
        (error: Error) => error.message
      );
    expect(receipt).toContain("verified Organization member turn");
    expect(f.provider).not.toHaveBeenCalled();
  });

  it("withholds an in-flight provider read when membership is revoked before its result is exposed", async () => {
    const f = await fixture();
    const provider = f.provider.getMockImplementation();
    if (!provider) {
      throw new Error("Provider fixture unavailable");
    }
    f.provider.mockImplementation(async (...args) => {
      f.authorize.mockRejectedValue(
        new Error("remote_agent.delegated_requester_unavailable")
      );
      return await provider(...args);
    });
    await expect(
      f.invoke("github_get_file_contents", {
        owner: "acme",
        repo: "private",
        path: "src/main.ts",
        ref: SHA,
      })
    ).rejects.toThrow("delegated_requester_unavailable");
    expect(f.provider).toHaveBeenCalledOnce();
  });
});
