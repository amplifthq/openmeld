import { describe, expect, it, vi } from "vitest";
import {
  createRemoteAgentCallbackContext,
  putRemoteAgentCallbackContext,
} from "../agent-core/callback-context";
import { getRemoteAgentConnectorToolDefinitions } from "../agent-core/connector-tools";
import { getRemoteAgentGitHubToolDefinitions } from "../agent-core/github-tools";
import { createRemoteAgentCodeModeFlueTool } from "../flue-adapter/code-mode";
import { executeRemoteAgentToolDefinition } from "../flue-adapter/tool-execution";
import { createSubmitTurnRequest, TEST_NOW_MS } from "./fixtures";
import capturedGitHubActions from "./fixtures/github-write-action-catalog.json";
import capturedActions from "./fixtures/openconnector-runtime-actions.json";
import { InMemoryDurableObjectStorage } from "./storage";

describe("connector replay live authorization", () => {
  it.each(
    ["github", "posthog"].flatMap((service) =>
      ["direct", "code_mode"].flatMap((carrier) =>
        ["revoked", "read_only", "connection_changed"].map((denial) => ({
          service,
          carrier,
          denial,
        }))
      )
    )
  )("blocks $service $denial before provider execution through $carrier", async ({
    service,
    carrier,
    denial,
  }) => {
    const request = createSubmitTurnRequest();
    const storage = new InMemoryDurableObjectStorage();
    const submissionId = "replay-authorization";
    const ack = {
      accepted: true,
      createdAt: TEST_NOW_MS,
      idempotencyKey: request.idempotencyKey,
      requestId: submissionId,
      status: "pending",
      submissionId,
    } as const;
    await putRemoteAgentCallbackContext(
      storage,
      createRemoteAgentCallbackContext({ ack, request, nowMs: TEST_NOW_MS })
    );
    const actionId =
      service === "github"
        ? "github.create_issue_comment"
        : "posthog.list_projects";
    const operationId = "original-operation";
    const connectionName = `original-${service}-account`;
    const record = vi.fn(() =>
      Promise.reject(new Error(`plugin.action_forbidden: ${denial}`))
    );
    const resolveConnection = vi.fn();
    const provider = vi.fn<typeof fetch>((_url, init) => {
      if (init?.method === "POST") {
        throw new Error("Unauthorized provider write");
      }
      return Promise.resolve(
        Response.json(
          service === "github" ? capturedGitHubActions : capturedActions
        )
      );
    });
    const dependencies = {
      connectorExecution: {
        baseUrl: "https://connectors.example.test",
        fetch: provider,
        runtimeToken: "test-runtime-token",
      },
      coreWorker: {
        centerAgentReadConnectorActionOperation: vi.fn(async () => ({
          operation: {
            actionId,
            operationId,
            connectionName,
            service,
            status: "pending",
            replayWindowRemainingMs: 60_000,
            executionConnection: {
              connectionName,
              ownerDisplayName: "Original requester",
              ownerUserId: "user_1",
              scope: "member",
              service,
            },
          },
        })),
        centerAgentRecordConnectorActionOperation: record,
        centerAgentResolveConnectorConnection: resolveConnection,
      },
      storage,
      submissionId,
    };
    const definitions =
      service === "github"
        ? getRemoteAgentGitHubToolDefinitions(dependencies as never)
        : getRemoteAgentConnectorToolDefinitions(dependencies as never);
    const definition = definitions.find(
      (tool) =>
        tool.name ===
        (service === "github"
          ? "github_create_issue_comment"
          : "openmeld_execute_app_action")
    );
    if (!definition) {
      throw new Error("Missing connector tool");
    }
    const toolInput =
      service === "github"
        ? {
            githubActor: "requester",
            operationId,
            owner: "example",
            repo: "repo",
            issueNumber: 1,
            body: "review",
          }
        : { actionId, operationId, service, input: { name: "project" } };
    const invoke = async () => {
      if (carrier === "direct") {
        return await executeRemoteAgentToolDefinition({
          definition,
          storage,
          submissionId,
          toolInput,
        });
      }
      const codeMode = await createRemoteAgentCodeModeFlueTool({
        definitions: [definition],
        env: {},
        loader: {} as WorkerLoader,
        storage,
        submissionId,
        runtime: {
          createExecutor: () => ({}),
          createCodeTool: ({ tools }) => ({
            description: "Replay original operation",
            execute: async () => ({
              result: await tools[definition.name]?.execute?.(toolInput, {
                toolCallId: "exact-replay",
                messages: [],
              }),
            }),
          }),
        },
      });
      return await codeMode.run({
        data: { code: "async () => codemode.execute(input)" },
        log: console,
        toolCallId: "authorization-script",
      });
    };
    await expect(invoke()).rejects.toThrow(
      `plugin.action_forbidden: ${denial}`
    );
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionName,
        operationId,
        outcome: "attempted",
      })
    );
    expect(resolveConnection).not.toHaveBeenCalled();
    expect(
      provider.mock.calls.filter(([, init]) => init?.method === "POST")
    ).toHaveLength(0);
  });
});
