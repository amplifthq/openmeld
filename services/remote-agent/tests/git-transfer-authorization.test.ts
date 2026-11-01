import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  pluginConnectionGrantSchema,
  remoteAgentExecutionScopeKey,
  remoteAgentGitConnectionResultSchema,
  remoteAgentGitTransferGrantSchema,
  resolveRemoteAgentExecutionScope,
} from "@openmeld/schemas";
import { describe, expect, it, vi } from "vitest";
import {
  createRemoteAgentCallbackContext,
  putRemoteAgentCallbackContext,
} from "../agent-core/callback-context";
import { buildRemoteAgentCoreContext } from "../agent-core/tool-context";
import { createComputerGitConnectionTool } from "../flue-adapter/computer-git-connection";
import { authorizeGitTransfer } from "../flue-adapter/git-transfer-authorization";
import { authorizePluginConnection } from "../flue-adapter/plugin-connection-authorization";
import { executionAccessFixture } from "./execution-access-fixture";
import { createSubmitTurnRequest, TEST_NOW_MS } from "./fixtures";
import { createGitHttpProxy } from "./fixtures/git-http-proxy";
import { selectedRepositoryWorkTarget } from "./fixtures/work-target";
import { InMemoryDurableObjectStorage } from "./storage";

const NATIVE_GIT_URL =
  /^http:\/\/computer\.internal\/[a-f0-9]+\/acme\/private\.git$/u;

function fixture() {
  const request = createSubmitTurnRequest();
  const context = createRemoteAgentCallbackContext({
    request,
    nowMs: TEST_NOW_MS,
    ack: {
      accepted: true,
      createdAt: TEST_NOW_MS,
      idempotencyKey: request.idempotencyKey,
      requestId: "git-transfer-execution",
      submissionId: "git-transfer-execution",
      status: "pending",
    },
  });
  const scope = {
    ...resolveRemoteAgentExecutionScope(context),
    principal: { kind: "agent" as const, profileId: "agt_parent" },
  };
  const connection = {
    canDisconnect: true,
    connectionName: "member-github",
    createdAtMs: TEST_NOW_MS,
    disconnectedAtMs: null,
    organizationId: context.organizationId,
    ownerDisplayName: "Requester",
    scope: "member" as "member" | "shared",
    service: "github" as const,
    status: "active" as "active" | "disconnected",
    updatedAtMs: TEST_NOW_MS,
    userId: "user_1",
  };
  const grant = remoteAgentGitTransferGrantSchema.parse({
    operationId: "git-operation",
    organizationId: context.organizationId,
    requesterUserId: "user_1",
    owner: "acme",
    repo: "private",
    authorization: {
      context: buildRemoteAgentCoreContext(
        context,
        "git-transfer:git-operation"
      ),
      submissionId: context.submissionId,
      effect: "read",
      sources: [
        {
          kind: "plugin_connection",
          service: "github",
          connectionName: connection.connectionName,
          connectionUpdatedAtMs: connection.updatedAtMs,
        },
      ],
    },
    scopeKey: remoteAgentExecutionScopeKey(scope),
    expiresAtMs: Date.now() + 60_000,
  });
  const authorizeRemoteAgentExecutionAccess = vi.fn(async () => ({
    scope,
    submissionId: context.submissionId,
    delegatedRequesterSupported: true as const,
    delegatedRequester: {
      delegationId: "delegation-1",
      parentDeliveryId: "parent-1",
      memberId: "member_123",
      userId: "user_1",
      profileId: "human-1",
    },
  }));
  const centerAgentResolveConnectorConnection = vi.fn(async () => ({
    connection,
    selection: "requester",
    permission: "read",
  }));
  return {
    context,
    grant,
    connection,
    authorizeRemoteAgentExecutionAccess,
    centerAgentResolveConnectorConnection,
  };
}

describe("Git transfer authorization", () => {
  it("keeps clone identity and edited files across expired transport and a later execution", async () => {
    const root = await mkdtemp(join(tmpdir(), "openmeld-git-connection-"));
    let allowedPrefix = "";
    const proxy = await createGitHttpProxy(
      root,
      (path) => Boolean(allowedPrefix) && path.startsWith(allowedPrefix)
    );
    const git = async (...args: string[]) =>
      (
        await promisify(execFile)("git", args, {
          env: {
            ...process.env,
            GIT_CONFIG_NOSYSTEM: "1",
            GIT_CONFIG_GLOBAL: "/dev/null",
            GIT_TERMINAL_PROMPT: "0",
            http_proxy: proxy.url,
            HTTP_PROXY: proxy.url,
            ALL_PROXY: "",
            all_proxy: "",
            NO_PROXY: "",
            no_proxy: "",
          },
        })
      ).stdout.trim();
    try {
      const seed = join(root, "seed");
      const checkout = join(root, "checkout");
      await git("init", "-b", "main", seed);
      await writeFile(join(seed, "report.txt"), "saved original\n");
      await git("-C", seed, "add", "report.txt");
      await git(
        "-C",
        seed,
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.invalid",
        "commit",
        "-m",
        "test: seed report"
      );
      await git("clone", "--bare", seed, join(root, "private.git"));
      const connect = async (submissionId: string) => {
        const f = fixture();
        const context = { ...f.context, submissionId };
        const storage = new InMemoryDurableObjectStorage();
        await putRemoteAgentCallbackContext(storage, context);
        const tool = createComputerGitConnectionTool({
          context,
          storage,
          coreWorker: {
            centerAgentWorkTarget: async () =>
              selectedRepositoryWorkTarget(context, {
                owner: "acme",
                repo: "private",
              }),
            authorizeRemoteAgentExecutionAccess: vi.fn(
              executionAccessFixture(context)
            ),
            centerAgentResolveConnectorConnection:
              f.centerAgentResolveConnectorConnection,
          },
          workspaceAccess: {
            registerGitTransferGrant: (grant) => {
              allowedPrefix = `/${grant.operationId}/acme/private.git/`;
              return Promise.resolve();
            },
            withWorkspace: () => {
              throw new Error("Must not access repository files");
            },
          },
        });
        return remoteAgentGitConnectionResultSchema.parse(
          await tool.execute({
            key: "repository",
            owner: "acme",
            repo: "private",
            githubActor: "requester",
          })
        );
      };
      const first = await connect("first-execution");
      await git(...first.gitArguments, "clone", first.repositoryUrl, checkout);
      expect(
        await git("-C", checkout, "config", "--get", "remote.origin.url")
      ).toBe(first.repositoryUrl);
      await writeFile(join(checkout, "report.txt"), "retained local edit\n");
      allowedPrefix = "";
      await expect(
        git(...first.gitArguments, "-C", checkout, "fetch", "origin")
      ).rejects.toThrow("403");
      const later = await connect("later-execution");
      expect(later.url).not.toBe(first.url);
      await git(...later.gitArguments, "-C", checkout, "fetch", "origin");
      expect(await readFile(join(checkout, "report.txt"), "utf8")).toBe(
        "retained local edit\n"
      );
      const config = await readFile(join(checkout, ".git/config"), "utf8");
      expect(config).toContain(first.repositoryUrl);
      expect(config).not.toContain("computer.internal");
      expect(config).not.toContain("insteadOf");
    } finally {
      await proxy.close();
      await rm(root, { recursive: true, force: true });
    }
  });
  it("reauthorizes generic native reads and stops expired, replaced, revoked, or action-delegated access", async () => {
    const f = fixture();
    const grant = pluginConnectionGrantSchema.parse({
      id: "a".repeat(64),
      service: "github",
      organizationId: f.grant.organizationId,
      requesterUserId: f.grant.requesterUserId,
      connectionName: f.connection.connectionName,
      connectionUpdatedAtMs: f.connection.updatedAtMs,
      connectionScope: "member",
      expiresAtMs: Date.now() + 60_000,
      authority: {
        kind: "remote",
        authorization: f.grant.authorization,
        scopeKey: f.grant.scopeKey,
      },
    });
    await expect(authorizePluginConnection(f, grant)).resolves.toMatchObject({
      connectionName: "member-github",
    });
    await expect(
      authorizePluginConnection(f, { ...grant, expiresAtMs: Date.now() - 1 })
    ).rejects.toThrow("connection_expired");
    await expect(
      authorizePluginConnection(f, {
        ...grant,
        connectionName: "other-account",
      })
    ).rejects.toThrow("connection_changed");
    await expect(
      authorizePluginConnection(f, {
        ...grant,
        authority: {
          kind: "remote",
          scopeKey: f.grant.scopeKey,
          authorization: {
            ...f.grant.authorization,
            includeDelegatedRequester: true,
          },
        },
      })
    ).rejects.toThrow("native_delegation_not_supported");
    f.centerAgentResolveConnectorConnection.mockResolvedValue({
      connection: f.connection,
      selection: "requester",
      permission: "none",
    });
    await expect(authorizePluginConnection(f, grant)).rejects.toThrow();
    f.centerAgentResolveConnectorConnection.mockResolvedValue({
      connection: {
        ...f.connection,
        updatedAtMs: f.connection.updatedAtMs + 1,
      },
      selection: "requester",
      permission: "read",
    });
    await expect(authorizePluginConnection(f, grant)).rejects.toThrow(
      "connection_changed"
    );
  });
  it.each([
    "requester",
    "organization",
  ] as const)("connects native Git through the exact %s Plugin and keeps retries stable", async (actor) => {
    const f = fixture();
    const storage = new InMemoryDurableObjectStorage();
    await putRemoteAgentCallbackContext(storage, f.context);
    const connection = {
      ...f.connection,
      scope: actor === "requester" ? ("member" as const) : ("shared" as const),
    };
    const register = vi.fn((_grant: unknown) => Promise.resolve());
    const authorize = vi.fn(executionAccessFixture(f.context));
    const tool = createComputerGitConnectionTool({
      context: f.context,
      storage,
      coreWorker: {
        centerAgentWorkTarget: async () =>
          selectedRepositoryWorkTarget(f.context, {
            owner: "acme",
            repo: "private",
          }),
        authorizeRemoteAgentExecutionAccess: authorize,
        centerAgentResolveConnectorConnection: async () => ({
          connection,
          permission: "read",
          selection: actor === "requester" ? "requester" : "shared",
        }),
      },
      workspaceAccess: {
        registerGitTransferGrant: register,
        withWorkspace: () => {
          throw new Error("Connection must not download repository files");
        },
      },
    });
    const request = {
      key: "native-clone",
      owner: "acme",
      repo: "private",
      githubActor: actor,
    };
    await expect(
      tool.execute({ ...request, repo: "another-project" })
    ).rejects.toThrow("work_target.destination_mismatch");
    expect(register).not.toHaveBeenCalled();
    const first = await tool.execute(request);
    const retry = await tool.execute(request);
    expect(first).toMatchObject({
      backend: "container",
      connectionScope: connection.scope,
      url: expect.stringMatching(NATIVE_GIT_URL),
    });
    expect(retry).toMatchObject({ url: (first as { url: string }).url });
    expect(register.mock.calls[0]?.[0]).toMatchObject({
      connectionScope: connection.scope,
      requesterUserId: "user_1",
      owner: "acme",
      repo: "private",
    });
    authorize.mockRejectedValue(new Error("access revoked"));
    await expect(tool.execute(request)).rejects.toThrow("access revoked");
    expect(register).toHaveBeenCalledTimes(2);
  });
  it("reauthorizes the exact organization connection without substituting the member account", async () => {
    const f = fixture();
    const shared = {
      ...f.connection,
      scope: "shared" as const,
      userId: "organization-admin",
    };
    f.centerAgentResolveConnectorConnection.mockResolvedValue({
      connection: shared,
      selection: "shared",
      permission: "read",
    });
    const grant = { ...f.grant, connectionScope: "shared" as const };
    await expect(authorizeGitTransfer(f, grant)).resolves.toMatchObject({
      connection: shared,
    });
    expect(f.centerAgentResolveConnectorConnection).toHaveBeenCalledWith(
      expect.objectContaining({ connectionPreference: "shared" })
    );
    f.centerAgentResolveConnectorConnection.mockResolvedValue({
      connection: f.connection,
      selection: "requester",
      permission: "read",
    });
    await expect(authorizeGitTransfer(f, grant)).rejects.toThrow(
      "connection_changed"
    );
  });
  it("rechecks the recorded requester and exact source on each host transfer", async () => {
    const f = fixture();
    const grant = {
      ...f.grant,
      authorization: {
        ...f.grant.authorization,
        includeDelegatedRequester: true as const,
      },
    };
    await authorizeGitTransfer(f, grant);
    expect(f.authorizeRemoteAgentExecutionAccess).toHaveBeenCalledWith(
      expect.objectContaining({
        includeDelegatedRequester: true,
        sources: grant.authorization.sources,
      })
    );
    expect(f.centerAgentResolveConnectorConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        includeDelegatedRequester: true,
        requesterUserId: "user_1",
      })
    );
    f.authorizeRemoteAgentExecutionAccess.mockRejectedValue(
      new Error("member revoked")
    );
    await expect(authorizeGitTransfer(f, grant)).rejects.toThrow(
      "member revoked"
    );
    expect(f.centerAgentResolveConnectorConnection).toHaveBeenCalledTimes(1);
  });

  it.each([
    "old_core",
    "changed_requester",
    "changed_connection",
    "changed_version",
  ])("rejects delegated transfer after %s", async (denial) => {
    const f = fixture();
    const grant = {
      ...f.grant,
      authorization: {
        ...f.grant.authorization,
        includeDelegatedRequester: true as const,
      },
    };
    if (denial === "old_core" || denial === "changed_requester") {
      const original = await f.authorizeRemoteAgentExecutionAccess();
      f.authorizeRemoteAgentExecutionAccess.mockResolvedValue({
        ...original,
        ...(denial === "old_core"
          ? {
              delegatedRequesterSupported: undefined,
              delegatedRequester: undefined,
            }
          : {
              delegatedRequester: {
                ...original.delegatedRequester,
                userId: "another-user",
              },
            }),
      } as typeof original);
    } else {
      f.centerAgentResolveConnectorConnection.mockResolvedValue({
        connection: {
          ...f.connection,
          ...(denial === "changed_connection"
            ? { connectionName: "replacement" }
            : { updatedAtMs: TEST_NOW_MS + 1 }),
        },
        selection: "requester",
        permission: "read",
      });
    }
    await expect(authorizeGitTransfer(f, grant)).rejects.toThrow();
  });

  it("accepts the original requester on an active Center Agent execution", async () => {
    const f = fixture();
    await authorizeGitTransfer(f, f.grant);
    expect(f.authorizeRemoteAgentExecutionAccess).toHaveBeenCalledWith({
      context: f.grant.authorization.context,
      submissionId: f.grant.authorization.submissionId,
      effect: "read",
    });
    expect(f.centerAgentResolveConnectorConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        requesterUserId: "user_1",
        connectionPreference: "requester",
        service: "github",
      })
    );
  });

  it("rejects a disconnected requester connection", async () => {
    const f = fixture();
    f.centerAgentResolveConnectorConnection.mockResolvedValueOnce({
      connection: { ...f.connection, status: "disconnected" },
      selection: "requester",
      permission: "read",
    });
    await expect(authorizeGitTransfer(f, f.grant)).rejects.toThrow(
      "plugin.connection.requester_connection_changed"
    );
  });

  it("rejects a mismatched execution scope before resolving a connection", async () => {
    const f = fixture();
    await expect(
      authorizeGitTransfer(f, { ...f.grant, scopeKey: "another-execution" })
    ).rejects.toThrow("plugin.connection.transfer_audience_mismatch");
    expect(f.centerAgentResolveConnectorConnection).not.toHaveBeenCalled();
  });
});
