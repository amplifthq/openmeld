import { openConnectorRuntimeActionSchema } from "@openmeld/schemas";
import type { CenterAgentRecordConnectorActionOperationResponse } from "@openmeld/schemas/types";
import { describe, expect, it, vi } from "vitest";
import {
  createRemoteAgentCallbackContext,
  putRemoteAgentCallbackContext,
  readRemoteAgentCallbackContext,
} from "../agent-core/callback-context";
import {
  getRemoteAgentConnectorToolDefinitions,
  listConnectorActionCatalog,
  REMOTE_AGENT_CONNECTOR_TOOL_NAMES,
  type RemoteAgentConnectorToolName,
  runAndFinalizeConnectorAction,
} from "../agent-core/connector-tools";
import { buildRemoteAgentToolContext } from "../agent-core/tool-context";
import {
  listOpenConnectorActions,
  searchOpenConnectorActions,
} from "../connectors/open-connector-runtime";
import { executeRemoteAgentToolDefinition } from "../flue-adapter/tool-execution";
import {
  createRoutineTurnEnvelope,
  createSubmitTurnRequest,
  TEST_NOW_MS,
} from "./fixtures";
// Selected fields captured from GitHub GET /repos/amplifthq/openmeld/issues/1649 on 2026-10-11.
import capturedGitHubIssue from "./fixtures/github-issue-observation.json";
import { linearIssueCreateInputSchema } from "./fixtures/linear-issue-action";
import openConnectorRuntimeActions from "./fixtures/openconnector-runtime-actions.json";
import { InMemoryDurableObjectStorage } from "./storage";

const ACK = {
  accepted: true,
  createdAt: TEST_NOW_MS,
  idempotencyKey: "remote-agent:dispatch_123",
  requestId: "flue_submission_123",
  status: "pending",
  submissionId: "flue_submission_123",
} as const;
const [capturedExecutableOpenConnectorAction] =
  openConnectorRuntimeActions.data;
if (!capturedExecutableOpenConnectorAction) {
  throw new Error("OpenConnector runtime action fixture is empty.");
}
const CONNECTOR_OPERATION_ATTRIBUTION = {
  actorProfileId: "agt_11111111-1111-4111-8111-111111111111",
  onBehalfOf: {
    displayName: "Felix",
    profileId: "22222222-2222-4222-8222-222222222222",
    userId: "user_1",
  },
} as const;
describe("Remote Agent generic App tools", () => {
  it.each([
    "pending",
    "approved",
    "rejected",
    "expired",
    "revoked",
    "legacy",
  ] as const)("reads %s App confirmation without executing or approving it", async (state) => {
    const operation =
      state === "approved"
        ? {
            actionId: "linear.create_linear_issue",
            operationId: "original-operation",
            service: "linear",
            connectionName: "linear-shared",
            createdAtMs: TEST_NOW_MS,
            executionConnection: {
              connectionName: "linear-shared",
              service: "linear",
              scope: "shared",
              ownerUserId: "user_1",
              ownerDisplayName: "Felix",
            },
            linearIssueReceipt: null,
            providerExecutionId: "provider-linear-1",
            status: "completed",
            replay: { allowed: false, reason: "operation_terminal" },
            replayWindowRemainingMs: 1000,
          }
        : null;
    const requestAuthorization =
      state === "legacy"
        ? undefined
        : {
            requestId: "11111111-1111-4111-8111-111111111111",
            state,
            continuation: state === "approved" ? "unavailable" : null,
          };
    const read = vi.fn(async () => ({
      operation,
      ...(requestAuthorization ? { requestAuthorization } : {}),
    }));
    const record = vi.fn();
    const fetchMock = vi.fn<typeof fetch>();
    const tools = getRemoteAgentConnectorToolDefinitions({
      coreWorker: {
        centerAgentReadConnectorActionOperation: read as never,
        centerAgentRecordConnectorActionOperation: record,
      },
      connectorExecution: {
        baseUrl: "https://connectors.example.test",
        fetch: fetchMock,
        runtimeToken: "test-runtime-token",
      },
      storage: await createStorage(createSubmitTurnRequest()),
      submissionId: ACK.submissionId,
    });
    const result = await executeTool(tools, "openmeld_get_app_action_status", {
      service: "linear",
      actionId: "linear.create_linear_issue",
      operationId: "original-operation",
    });
    expect(result).toMatchObject({
      operation,
      requestAuthorizationSupported: state !== "legacy",
      ...(requestAuthorization ? { requestAuthorization } : {}),
    });
    expect(result).not.toHaveProperty("operation.operationReplayExpiresAtMs");
    expect(read).toHaveBeenCalledWith(
      expect.objectContaining({
        includeRequestAuthorization: true,
        operationId: "original-operation",
      })
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });

  it.each([
    undefined,
    "explicit_request",
  ] as const)("retains Linear confirmation and resumes the same operation (authority=%s)", async (issueDestinationAuthority) => {
    const request = createSubmitTurnRequest();
    const actionId = "linear.create_linear_issue";
    const operationId = "linear-confirmed-issue";
    const destination = {
      provider: "linear" as const,
      teamId: "a86813e7-c458-4af2-8cfa-73a796d81201",
    };
    const providerData = {
      id: "73c7947f-5bba-4e67-a668-9392b70cd424",
      identifier: "PAY-82",
      ticket_url: "https://linear.app/acme/issue/PAY-82/fix-payment-retry",
    };
    const fetchMock = vi.fn<typeof fetch>(async (_url, init) =>
      Response.json(
        init?.method === "POST"
          ? {
              data: providerData,
              message: "OK",
              meta: {
                actionId,
                auditPersisted: true,
                executionId: "linear-result",
              },
              success: true,
            }
          : {
              ...openConnectorRuntimeActions,
              data: [
                {
                  ...capturedExecutableOpenConnectorAction,
                  id: actionId,
                  service: "linear",
                  effect: "write",
                  inputSchema: linearIssueCreateInputSchema,
                  outputSchema: { type: "object" },
                },
              ],
            }
      )
    );
    const record = vi
      .fn(async (entry: { outcome: string }) => ({
        attribution: CONNECTOR_OPERATION_ATTRIBUTION,
        operationId,
        providerExecutionId:
          entry.outcome === "attempted" ? null : "linear-result",
        recorded: true,
        replayed: false,
        executionAllowed: entry.outcome === "attempted",
        status: entry.outcome === "attempted" ? "pending" : "completed",
      }))
      .mockRejectedValueOnce(
        new Error(
          'HTTP 409: {"error":{"code":"project.issue_confirmation_required","message":"Confirm the exact destination."}}'
        )
      );
    const resolve = vi.fn(async () => ({
      basis: "confirmation_required",
      destination,
      projectId: null,
      projectRevision: null,
    }));
    const dependencies = {
      connectorExecution: {
        baseUrl: "https://connectors.example.test",
        fetch: fetchMock,
        runtimeToken: "test-runtime-token",
      },
      coreWorker: {
        centerAgentReadConnectorActionOperation: vi.fn(async () => ({
          operation: null,
        })),
        centerAgentRecordConnectorActionOperation: record as never,
        centerAgentResolveConnectorConnection: vi.fn(async () =>
          connectionSelection({
            ownerDisplayName: "Felix",
            service: "linear",
            userId: "user_1",
          })
        ),
        resolveProjectIssueAction: resolve as never,
      },
      storage: await createStorage(request),
      submissionId: ACK.submissionId,
    };
    const payload = {
      actionId,
      service: "linear",
      operationId,
      input: { team_id: destination.teamId, title: "Fix payment retry" },
      ...(issueDestinationAuthority ? { issueDestinationAuthority } : {}),
    };
    await expect(
      executeTool(
        getRemoteAgentConnectorToolDefinitions(dependencies),
        "openmeld_execute_app_action",
        payload
      )
    ).resolves.toMatchObject({
      status: "awaiting_confirmation",
      operationId,
      actionId,
      issueDestination: destination,
      providerSubmitted: false,
    });
    expect(
      fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")
    ).toHaveLength(0);
    const continued = await createNextTurnConnectorTools({
      ...dependencies,
      request,
    });
    await expect(
      executeTool(continued, "openmeld_execute_app_action", payload)
    ).resolves.toMatchObject({ operationId, data: providerData });
    const claims = record.mock.calls
      .map(([entry]) => entry)
      .filter((entry) => entry.outcome === "attempted");
    expect(claims).toHaveLength(2);
    expect(claims[0]).toMatchObject({
      operationId,
      issueDestination: destination,
      ...(issueDestinationAuthority ? { issueDestinationAuthority } : {}),
    });
    expect(claims[1]).toMatchObject({
      requestSignature: (claims[0] as unknown as { requestSignature: string })
        .requestSignature,
    });
    expect(
      fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")
    ).toHaveLength(1);
    expect(
      JSON.parse(
        String(
          fetchMock.mock.calls.find(([, init]) => init?.method === "POST")?.[1]
            ?.body
        )
      )
    ).not.toHaveProperty("issueDestinationAuthority");
    if (issueDestinationAuthority) {
      expect(resolve).not.toHaveBeenCalled();
    }
  });

  it("retains provider completion while Task synchronization is pending", async () => {
    const storage = await createStorage(createSubmitTurnRequest());
    const issue = {
      ...capturedGitHubIssue,
      state: "closed",
      state_reason: "completed",
    };
    const actionInput = {
      owner: "amplifthq",
      repo: "openmeld",
      issueNumber: issue.number,
      state: "closed",
    };
    const record = vi.fn(async () => ({
      attribution: CONNECTOR_OPERATION_ATTRIBUTION,
      operationId: "close-issue",
      providerExecutionId: "github-result",
      recorded: true,
      replayed: false,
      status: "completed" as const,
      githubTaskSync: { status: "pending", closedTaskIds: [] },
    }));
    const toolContext = await buildRemoteAgentToolContext({
      storage,
      submissionId: ACK.submissionId,
      toolName: "github_update_issue",
    });
    const result = await runAndFinalizeConnectorAction({
      githubActor: "requester",
      connectionName: "github-personal",
      requestSignature: "c".repeat(64),
      toolContext,
      request: {
        actionId: "github.update_issue",
        service: "github",
        operationId: "close-issue",
        input: actionInput,
      },
      dependencies: {
        storage,
        submissionId: ACK.submissionId,
        coreWorker: {
          centerAgentRecordConnectorActionOperation: record as never,
        },
        connectorExecution: {
          baseUrl: "https://connectors.example.test",
          runtimeToken: "test-runtime-token",
          fetch: vi.fn<typeof fetch>(async () =>
            Response.json({
              data: issue,
              message: "OK",
              meta: {
                actionId: "github.update_issue",
                auditPersisted: true,
                executionId: "github-result",
              },
              success: true,
            })
          ),
        },
      },
    });
    expect(result.data).toEqual(issue);
    expect(result.githubTaskSync).toEqual({
      status: "pending",
      closedTaskIds: [],
    });
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: "completed",
        githubIssueCompletion: {
          githubActor: "requester",
          actionInput,
          observation: {
            owner: "amplifthq",
            repo: "openmeld",
            number: issue.number,
            state: issue.state,
            stateReason: issue.state_reason,
            updatedAt: issue.updated_at,
          },
        },
      })
    );
  });
  it.each([
    ["completed", "direct"],
    ["failed", "direct"],
    ["completed", "code_mode"],
    ["failed", "code_mode"],
  ] as const)("preserves a durable %s duplicate receipt through %s", async (status, source) => {
    const action = {
      ...capturedExecutableOpenConnectorAction,
      effect: "write",
      operationType: "write",
    };
    const provider = vi.fn<typeof fetch>(async () =>
      Response.json({
        success: true,
        message: "OK",
        data: [action],
        meta: {},
      })
    );
    const executionConnection = {
      connectionName: "original-account",
      service: "posthog" as const,
      scope: "member" as const,
      ownerUserId: "user_1",
      ownerDisplayName: "Felix",
    };
    const storage = await createStorage(createSubmitTurnRequest());
    const tools = getRemoteAgentConnectorToolDefinitions({
      connectorExecution: {
        baseUrl: "https://connectors.example.test",
        fetch: provider,
        runtimeToken: "fixture",
      },
      coreWorker: {
        centerAgentReadConnectorActionOperation: vi.fn(async () => ({
          operation: null,
        })),
        centerAgentResolveConnectorConnection: vi.fn(async () =>
          connectionSelection({
            ownerDisplayName: "Felix",
            service: "posthog",
            userId: "user_1",
          })
        ),
        centerAgentRecordConnectorActionOperation: vi.fn(async () => ({
          attribution: CONNECTOR_OPERATION_ATTRIBUTION,
          executionConnection,
          operationId: "original-write",
          providerExecutionId: "provider-execution",
          recorded: true,
          replayed: true,
          status,
          executionAllowed: false,
          replay: { allowed: false, reason: "operation_terminal" },
        })) as never,
      },
      storage,
      submissionId: ACK.submissionId,
    });
    const definition = tools.find(
      (tool) => tool.name === "openmeld_execute_app_action"
    );
    if (!definition) {
      throw new Error("Missing action tool");
    }
    const receipt = await executeRemoteAgentToolDefinition({
      definition,
      storage,
      submissionId: ACK.submissionId,
      source,
      toolInput: {
        service: "posthog",
        actionId: action.id,
        operationId: "replacement-id",
        input: {},
      },
    });
    expect(
      provider.mock.calls.filter(([, init]) => init?.method === "POST")
    ).toHaveLength(0);
    expect(receipt).toMatchObject({
      status,
      operationId: "original-write",
      executionConnection,
      attribution: CONNECTOR_OPERATION_ATTRIBUTION,
    });
    expect(receipt).not.toHaveProperty("data");
    expect(receipt).not.toHaveProperty("executionConfirmation", "executed");
  });

  it.each([
    true,
    false,
  ])("requires Core's original-operation association before a verification read (supported: %s)", async (supported) => {
    const action = {
      ...capturedExecutableOpenConnectorAction,
      effect: "read",
      operationType: "read",
    };
    const reference = {
      operationId: "original-write",
      actionId: "posthog.create_dashboard",
    };
    const verification = {
      ...reference,
      requestSignature: "a".repeat(64),
      status: "outcome_unknown",
      interpretation: "read_evidence_only",
      connection: {
        connectionName: "org_aaaaaaaaaaaaaaaaaa__member__user_1__posthog",
        ownerDisplayName: "Felix",
        ownerUserId: "user_1",
        scope: "member",
        service: "posthog",
      },
    };
    const provider = vi.fn<typeof fetch>((_url, init) =>
      Promise.resolve(
        Response.json(
          init?.method === "POST"
            ? {
                success: true,
                message: "OK",
                data: [],
                meta: {
                  actionId: action.id,
                  executionId: "verification-read",
                  auditPersisted: true,
                },
                outputSchema: action.outputSchema,
              }
            : { success: true, message: "OK", data: [action], meta: {} }
        )
      )
    );
    const record = vi.fn(async (entry: { outcome: string }) => ({
      attribution: CONNECTOR_OPERATION_ATTRIBUTION,
      operationId: "verification-read",
      providerExecutionId: null,
      recorded: true,
      replayed: false,
      status: entry.outcome === "attempted" ? "pending" : "completed",
      ...(supported ? { verificationOf: verification } : {}),
    }));
    const tools = getRemoteAgentConnectorToolDefinitions({
      connectorExecution: {
        baseUrl: "https://connectors.example.test",
        fetch: provider,
        runtimeToken: "fixture",
      },
      coreWorker: {
        centerAgentReadConnectorActionOperation: vi.fn(async () => ({
          operation: null,
        })),
        centerAgentRecordConnectorActionOperation: record as never,
        centerAgentResolveConnectorConnection: vi.fn(async () =>
          connectionSelection({
            ownerDisplayName: "Felix",
            service: "posthog",
            userId: "user_1",
          })
        ),
      },
      storage: await createStorage(createSubmitTurnRequest()),
      submissionId: ACK.submissionId,
    });
    const invoke = executeTool(tools, "openmeld_execute_app_action", {
      service: "posthog",
      actionId: action.id,
      operationId: "verification-read",
      input: {},
      verificationOf: reference,
    });
    if (supported) {
      await expect(invoke).resolves.toMatchObject({
        data: [],
        verificationOf: verification,
      });
    } else {
      await expect(invoke).rejects.toThrow("plugin.verification_unavailable");
    }
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        verificationOf: reference,
        effect: "read",
        outcome: "attempted",
      })
    );
    expect(
      provider.mock.calls.filter(([, init]) => init?.method === "POST")
    ).toHaveLength(supported ? 1 : 0);
  });
  it.each([
    "old_core",
    "expired",
  ] as const)("keeps a pending read safe to replay with a %s window", async (window) => {
    const action = {
      ...capturedExecutableOpenConnectorAction,
      operationType: "read" as const,
    };
    const connectionName = "org_aaaaaaaaaaaaaaaaaa__shared__posthog";
    const operationId = "read-pending-original";
    let claimed = false;
    let requests = 0;
    const fetchMock = vi.fn<typeof fetch>((_url, init) => {
      if (init?.method !== "POST") {
        return Promise.resolve(
          Response.json({
            success: true,
            message: "OK",
            data: [action],
            meta: {},
          })
        );
      }
      requests += 1;
      return Promise.resolve(
        requests === 1
          ? Response.json(
              {
                success: false,
                errorCode: "idempotency_request_in_progress",
                message:
                  "A request with this Idempotency-Key is still in progress.",
                data: null,
                meta: { actionId: action.id },
              },
              { status: 409 }
            )
          : Response.json({
              success: true,
              message: "OK",
              data: [],
              meta: {
                actionId: action.id,
                executionId: "read-execution",
                auditPersisted: true,
              },
              outputSchema: action.outputSchema,
            })
      );
    });
    const executionConnection = {
      connectionName,
      ownerDisplayName: "Requester",
      ownerUserId: "user_1",
      scope: "shared" as const,
      service: "posthog" as const,
    };
    const record = vi.fn((entry: { outcome: string; effect?: string }) => {
      const replayed = claimed;
      claimed = true;
      return Promise.resolve({
        attribution: CONNECTOR_OPERATION_ATTRIBUTION,
        executionConnection,
        operationId,
        recorded: true,
        replayed,
        status: entry.outcome === "attempted" ? "pending" : "completed",
        providerExecutionId:
          entry.outcome === "attempted" ? null : "read-execution",
        ...(window === "expired" ? { replayWindowRemainingMs: 0 } : {}),
      });
    });
    const tools = getRemoteAgentConnectorToolDefinitions({
      connectorExecution: {
        baseUrl: "https://connectors.example.test",
        fetch: fetchMock,
        runtimeToken: "test-runtime-token",
      },
      coreWorker: {
        centerAgentReadConnectorActionOperation: (() =>
          Promise.resolve({
            operation: claimed
              ? {
                  actionId: action.id,
                  connectionName,
                  executionConnection,
                  operationId,
                  service: "posthog",
                  status: "pending",
                }
              : null,
          })) as never,
        centerAgentRecordConnectorActionOperation: record as never,
        centerAgentResolveConnectorConnection: (() =>
          Promise.resolve(
            connectionSelection({
              ownerDisplayName: "Requester",
              userId: "user_1",
              service: "posthog",
              scope: "shared",
            })
          )) as never,
      },
      storage: await createStorage(createSubmitTurnRequest()),
      submissionId: ACK.submissionId,
    });
    const input = {
      actionId: action.id,
      operationId,
      service: "posthog",
      input: {},
    };
    await expect(
      executeTool(tools, "openmeld_execute_app_action", input)
    ).rejects.toThrow("still processing");
    await expect(
      executeTool(tools, "openmeld_execute_app_action", input)
    ).resolves.toMatchObject({ data: [], operationId, replayed: true });
    expect(
      record.mock.calls
        .filter(([entry]) => entry.outcome === "attempted")
        .map(([entry]) => entry.effect)
    ).toEqual(["read", "read"]);
    const writes = fetchMock.mock.calls.filter(
      ([, init]) => init?.method === "POST"
    );
    expect(writes).toHaveLength(2);
    expect(new Headers(writes[0]?.[1]?.headers).get("idempotency-key")).toBe(
      new Headers(writes[1]?.[1]?.headers).get("idempotency-key")
    );
  });

  it("offers the shared connection entry for a missing non-GitHub selection without claiming a disconnected account", async () => {
    const base = createSubmitTurnRequest();
    const request = createSubmitTurnRequest({
      turnEnvelope: {
        ...base.turnEnvelope,
        organization: {
          ...base.turnEnvelope.organization,
          webUrl: "https://openmeld.ai/o/acme",
        },
      },
    });
    const storage = await createStorage(request);
    const fetchMock = vi.fn<typeof fetch>();
    const tools = getRemoteAgentConnectorToolDefinitions({
      connectorExecution: { fetch: fetchMock },
      coreWorker: {
        centerAgentResolveConnectorConnection: vi.fn(async () => ({
          connection: null,
          selection: null,
        })),
      },
      storage,
      submissionId: ACK.submissionId,
    });
    await expect(
      executeTool(tools, "openmeld_list_app_actions", { service: "linear" })
    ).rejects.toThrow("does not prove the account is disconnected");
    expect(
      await readRemoteAgentCallbackContext(storage, ACK.submissionId)
    ).toMatchObject({
      pluginConnectionTarget: {
        kind: "plugin_connection",
        service: "linear",
        scope: "choose",
      },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    {
      error: new Error(
        'HTTP 403: {"ok":false,"error":{"code":"plugin.action_forbidden","message":"Agent access denied"}}'
      ),
      review: true,
    },
    { error: new Error("plugin.action_forbidden"), review: false },
    {
      error: new Error(
        'HTTP 503: {"ok":false,"error":{"code":"plugin.verification_unavailable","message":"Unavailable"}}'
      ),
      review: false,
    },
  ])("preserves the error and offers review only for a verified permission denial ($review)", async ({
    error,
    review,
  }) => {
    const base = createSubmitTurnRequest();
    const storage = await createStorage(
      createSubmitTurnRequest({
        turnEnvelope: {
          ...base.turnEnvelope,
          organization: {
            ...base.turnEnvelope.organization,
            webUrl: "https://openmeld.ai/o/acme",
          },
        },
      })
    );
    const tools = getRemoteAgentConnectorToolDefinitions({
      coreWorker: {
        centerAgentResolveConnectorConnection: vi.fn().mockRejectedValue(error),
      },
      storage,
      submissionId: ACK.submissionId,
    });
    await expect(
      executeTool(tools, "openmeld_list_app_actions", { service: "linear" })
    ).rejects.toThrow(error.message);
    const target = (
      await readRemoteAgentCallbackContext(storage, ACK.submissionId)
    )?.pluginConnectionTarget;
    if (review) {
      expect(target).toMatchObject({
        kind: "plugin_connection",
        service: "linear",
        scope: "choose",
      });
    } else {
      expect(target).toBeUndefined();
    }
  });

  it("registers discovery and execution as one shared tool surface", () => {
    const tools = getRemoteAgentConnectorToolDefinitions({
      coreWorker: {},
      storage: new InMemoryDurableObjectStorage(),
      submissionId: ACK.submissionId,
    });

    expect(tools.map((tool) => tool.name)).toEqual([
      ...REMOTE_AGENT_CONNECTOR_TOOL_NAMES,
    ]);
    const executeAction = tools.find(
      (tool) => tool.name === "openmeld_execute_app_action"
    );
    expect(executeAction?.description).toContain(
      "The discovered action's effect declares whether this call is a read, ordinary external write, or destructive external write"
    );
    expect(executeAction?.description).not.toContain("short reply");
    expect(executeAction?.description).not.toContain("Bare Yes or OK");
  });

  it("allows member research to execute connected App reads but rejects writes", async () => {
    const baseRequest = createSubmitTurnRequest();
    const request = {
      ...baseRequest,
      turnEnvelope: {
        ...baseRequest.turnEnvelope,
        trigger: {
          source: "member_research" as const,
          subjectDisplayName: "Morgan Lee",
          subjectUserId: "user-morgan",
          taskId: "member-research-task-1",
        },
      },
    };
    const action = {
      ...capturedExecutableOpenConnectorAction,
      operationType: "write" as const,
      id: "posthog.update_project",
      name: "Update project",
      service: "posthog" as const,
    };
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json({
        data: [action],
        message: "OK",
        meta: {},
        success: true,
      })
    );
    const tools = getRemoteAgentConnectorToolDefinitions({
      connectorExecution: {
        baseUrl: "https://connectors.example.test",
        fetch: fetchMock,
        runtimeToken: "test-runtime-token",
      },
      coreWorker: {},
      storage: await createStorage(request),
      submissionId: ACK.submissionId,
    });

    await expect(
      executeTool(tools, "openmeld_execute_app_action", {
        actionId: action.id,
        input: {},
        operationId: "member-research-write-1",
        service: "posthog",
      })
    ).rejects.toThrow(
      "Member research can only execute connected App actions declared read."
    );
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("lists member-first and shared fallback connections without exposing credentials", async () => {
    const request = createSubmitTurnRequest();
    const sender = requireMemberSender(request.turnEnvelope.sender);
    const centerAgentResolveConnectorConnection = vi.fn(
      async ({ service }: { service: string }) =>
        service === "posthog"
          ? connectionSelection({
              ownerDisplayName: "Ashley",
              service: "posthog",
              userId: sender.ownerUserId ?? "user_ashley",
            })
          : { connection: null, selection: null }
    );
    const tools = getRemoteAgentConnectorToolDefinitions({
      coreWorker: {
        centerAgentResolveConnectorConnection,
        centerAgentListConnectorServices: async () => ({
          services: ["posthog"],
        }),
      },
      storage: await createStorage(request),
      submissionId: ACK.submissionId,
    });

    await expect(
      executeTool(tools, "openmeld_list_connected_apps", {})
    ).resolves.toMatchObject({
      apps: expect.arrayContaining([
        {
          connected: null,
          connectionStored: true,
          descriptionUnavailable: false,
          health: { state: "unknown" },
          nativeHttp: null,
          nextAction: expect.any(String),
          name: "PostHog",
          scope: "member",
          selection: "requester",
          service: "posthog",
        },
      ]),
      github: {
        connectionStatus: "not_checked",
        instruction:
          "This Plugins list never reports GitHub access. For a GitHub request, call the matching github_* tool; it will verify the requested Organization or member GitHub connection.",
      },
    });
    expect(centerAgentResolveConnectorConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        requesterUserId: sender.ownerUserId,
        service: "posthog",
      })
    );
  });

  it("discovers exact provider action schemas through the selected connection", async () => {
    const request = createSubmitTurnRequest();
    const forkCatalog = {
      ...openConnectorRuntimeActions,
      data: [
        { ...capturedExecutableOpenConnectorAction, operationType: "read" },
        openConnectorRuntimeActions.data[1],
      ],
    };
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json(forkCatalog)
    );
    const tools = getRemoteAgentConnectorToolDefinitions({
      connectorExecution: {
        baseUrl: "https://connectors.example.test",
        fetch: fetchMock,
        runtimeToken: "test-runtime-token",
      },
      coreWorker: {
        centerAgentResolveConnectorConnection: vi.fn(async () =>
          connectionSelection({
            ownerDisplayName: "Ashley",
            service: "posthog",
            userId: "user_ashley",
          })
        ),
      },
      storage: await createStorage(request),
      submissionId: ACK.submissionId,
    });

    await expect(
      executeTool(tools, "openmeld_list_app_actions", {
        service: "posthog",
      })
    ).resolves.toEqual({
      actions: [
        {
          description: "List projects.",
          effect: "read",
          id: "posthog.list_projects",
          inputSchema: { properties: {}, type: "object" },
          name: "List projects",
          outputSchema: { type: "array" },
          requiredScopes: ["project:read"],
        },
      ],
      availableCount: 1,
      hasMore: false,
      matchingCount: 1,
      nextOffset: null,
      offset: 0,
      service: "posthog",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://connectors.example.test/v1/actions?service=posthog",
      expect.objectContaining({
        headers: { authorization: "Bearer test-runtime-token" },
      })
    );
  });

  it("uses OpenConnector search ranking for natural-language action discovery", async () => {
    const request = createSubmitTurnRequest();
    const action = {
      ...capturedExecutableOpenConnectorAction,
      description:
        "List or count Gmail messages with Gmail search filters, including unread inbox messages.",
      operationType: "read" as const,
      id: "gmail.fetch_emails",
      name: "fetch_emails",
      outputSchema: {
        properties: {
          messages: { type: "array" },
          resultSizeEstimate: {
            description: "Approximate result count.",
            type: "integer",
          },
        },
        type: "object",
      },
      service: "gmail",
    };
    const fetchMock = vi.fn<typeof fetch>((requestInfo) => {
      const url = String(requestInfo);
      if (url.includes("/v1/actions/search?")) {
        return Promise.resolve(
          Response.json({
            data: [
              {
                authenticated: true,
                description: action.description,
                operationType: "read",
                id: action.id,
                inputSchema: action.inputSchema,
                name: action.name,
                outputSchema: action.outputSchema,
                service: action.service,
              },
            ],
            message: "OK",
            meta: {},
            success: true,
          })
        );
      }
      return Promise.resolve(
        Response.json({
          data: [action],
          message: "OK",
          meta: {},
          success: true,
        })
      );
    });
    const tools = getRemoteAgentConnectorToolDefinitions({
      connectorExecution: {
        baseUrl: "https://connectors.example.test",
        fetch: fetchMock,
        runtimeToken: "test-runtime-token",
      },
      coreWorker: {
        centerAgentResolveConnectorConnection: vi.fn(async () =>
          connectionSelection({
            ownerDisplayName: "Ashley",
            service: "gmail",
            userId: "user_ashley",
          })
        ),
      },
      storage: await createStorage(request),
      submissionId: ACK.submissionId,
    });

    await expect(
      executeTool(tools, "openmeld_list_app_actions", {
        query: "unread inbox count",
        service: "gmail",
      })
    ).resolves.toMatchObject({
      actions: [
        expect.objectContaining({
          id: "gmail.fetch_emails",
          outputSchema: {
            properties: {
              messages: { type: "array" },
              resultSizeEstimate: {
                description: "Approximate result count.",
                type: "integer",
              },
            },
            type: "object",
          },
        }),
      ],
      availableCount: 1,
      matchingCount: 1,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://connectors.example.test/v1/actions/search?q=unread+inbox+count&service=gmail&limit=50",
      expect.objectContaining({
        headers: { authorization: "Bearer test-runtime-token" },
      })
    );
    await expect(
      listConnectorActionCatalog({
        connectorExecution: {
          baseUrl: "https://connectors.example.test",
          fetch: fetchMock,
          runtimeToken: "test-runtime-token",
        },
        query: "unread inbox count",
        readOnly: true,
        service: "gmail",
      })
    ).resolves.toMatchObject({
      actions: [expect.objectContaining({ effect: "read", id: action.id })],
      matchingCount: 1,
    });
  });

  it.each([
    false,
    true,
  ])("returns the action output contract with paginated provider data (execution schema=%s)", async (includeExecutionSchema) => {
    const request = createSubmitTurnRequest();
    const action = {
      ...capturedExecutableOpenConnectorAction,
      description:
        "List or count Gmail messages with Gmail search filters, including unread inbox messages.",
      effect: "read" as const,
      id: "gmail.fetch_emails",
      name: "fetch_emails",
      outputSchema: {
        properties: {
          messages: { type: "array" },
          resultSizeEstimate: {
            description: "Approximate result count.",
            type: "integer",
          },
        },
        type: "object",
      },
      service: "gmail",
    };
    const operationId = "gmail-unread-count";
    const providerExecutionId = "provider-gmail-unread-count";
    const providerData = {
      messages: Array.from({ length: 6 }, (_, index) => ({
        id: `message-${index + 1}`,
      })),
      resultSizeEstimate: 201,
    };
    const executionOutputSchema = {
      ...action.outputSchema,
      description:
        "Output from this exact execution, including the provider's result estimate.",
    };
    const fetchMock = vi.fn<typeof fetch>((url) => {
      if (String(url).includes("/v1/actions?service=gmail")) {
        return Promise.resolve(
          Response.json({
            data: [action],
            message: "OK",
            meta: {},
            success: true,
          })
        );
      }
      if (String(url).endsWith(`/v1/actions/${action.id}`)) {
        return Promise.resolve(
          Response.json({
            data: providerData,
            ...(includeExecutionSchema
              ? { outputSchema: executionOutputSchema }
              : {}),
            message: "OK",
            meta: {
              actionId: action.id,
              auditPersisted: true,
              executionId: providerExecutionId,
            },
            success: true,
          })
        );
      }
      throw new Error(`Unexpected connector URL: ${String(url)}`);
    });
    const centerAgentReadConnectorActionOperation = vi.fn(async () => ({
      operation: null,
    }));
    const centerAgentRecordConnectorActionOperation = vi.fn(
      async (entry: { outcome: string }) => ({
        attribution: CONNECTOR_OPERATION_ATTRIBUTION,
        operationId,
        providerExecutionId:
          entry.outcome === "attempted" ? null : providerExecutionId,
        recorded: true,
        replayed: false,
        status: entry.outcome === "attempted" ? "pending" : "completed",
      })
    );
    const tools = getRemoteAgentConnectorToolDefinitions({
      connectorExecution: {
        baseUrl: "https://connectors.example.test",
        fetch: fetchMock,
        runtimeToken: "test-runtime-token",
      },
      coreWorker: {
        centerAgentReadConnectorActionOperation:
          centerAgentReadConnectorActionOperation as never,
        centerAgentRecordConnectorActionOperation:
          centerAgentRecordConnectorActionOperation as never,
        centerAgentResolveConnectorConnection: vi.fn(async () =>
          connectionSelection({
            ownerDisplayName: "Felix",
            service: "gmail",
            userId: "user_1",
          })
        ),
      },
      storage: await createStorage(request),
      submissionId: ACK.submissionId,
    });

    await expect(
      executeTool(tools, "openmeld_execute_app_action", {
        actionId: action.id,
        input: { q: "is:unread in:inbox" },
        operationId,
        service: "gmail",
      })
    ).resolves.toMatchObject({
      actionId: action.id,
      data: providerData,
      outputSchema: includeExecutionSchema
        ? executionOutputSchema
        : action.outputSchema,
      replayed: false,
    });
  });

  it("fails closed when OpenConnector omits required action metadata", async () => {
    const request = createSubmitTurnRequest();
    const response = structuredClone(openConnectorRuntimeActions);
    (response.data[0] as Partial<(typeof response.data)[number]>).description =
      undefined;
    const tools = getRemoteAgentConnectorToolDefinitions({
      connectorExecution: {
        baseUrl: "https://connectors.example.test",
        fetch: vi.fn<typeof fetch>(async () => Response.json(response)),
        runtimeToken: "test-runtime-token",
      },
      coreWorker: {
        centerAgentResolveConnectorConnection: vi.fn(async () =>
          connectionSelection({
            ownerDisplayName: "Ashley",
            service: "posthog",
            userId: "user_ashley",
          })
        ),
      },
      storage: await createStorage(request),
      submissionId: ACK.submissionId,
    });

    await expect(
      executeTool(tools, "openmeld_list_app_actions", {
        service: "posthog",
      })
    ).rejects.toThrow("OpenConnector returned an invalid action catalog");
  });

  it("rejects conflicting effect metadata in catalog and search results", async () => {
    const action = {
      ...capturedExecutableOpenConnectorAction,
      effect: "read" as const,
      operationType: "write" as const,
    };
    const connectorExecution = {
      baseUrl: "https://connectors.example.test",
      fetch: vi.fn<typeof fetch>(async () =>
        Response.json({
          data: [action],
          message: "OK",
          meta: {},
          success: true,
        })
      ),
      runtimeToken: "test-runtime-token",
    };
    await expect(
      listOpenConnectorActions({ connectorExecution, service: "posthog" })
    ).rejects.toThrow("conflicting effect metadata");

    const searchResult = {
      authenticated: true,
      description: action.description,
      effect: "read",
      id: action.id,
      inputSchema: action.inputSchema,
      name: action.name,
      operationType: "write",
      outputSchema: action.outputSchema,
      service: action.service,
    };
    connectorExecution.fetch.mockImplementation(async () =>
      Response.json({
        data: [searchResult],
        message: "OK",
        meta: {},
        success: true,
      })
    );
    await expect(
      searchOpenConnectorActions({
        actions: [
          openConnectorRuntimeActionSchema.parse({
            ...capturedExecutableOpenConnectorAction,
            effect: "read",
          }),
        ],
        connectorExecution,
        query: "list projects",
        service: "posthog",
      })
    ).rejects.toThrow("conflicting effect metadata");
  });

  it("uses the declared effect even when an action name sounds destructive", async () => {
    const action = {
      ...capturedExecutableOpenConnectorAction,
      effect: "write" as const,
      id: "posthog.delete_project",
      name: "Delete project",
    };
    const tools = getRemoteAgentConnectorToolDefinitions({
      connectorExecution: {
        baseUrl: "https://connectors.example.test",
        fetch: vi.fn<typeof fetch>(async () =>
          Response.json({
            data: [action],
            message: "OK",
            meta: {},
            success: true,
          })
        ),
        runtimeToken: "test-runtime-token",
      },
      coreWorker: {
        centerAgentResolveConnectorConnection: vi.fn(async () =>
          connectionSelection({
            ownerDisplayName: "Ashley",
            service: "posthog",
            userId: "user_ashley",
          })
        ),
      },
      storage: await createStorage(createSubmitTurnRequest()),
      submissionId: ACK.submissionId,
    });

    await expect(
      executeTool(tools, "openmeld_list_app_actions", { service: "posthog" })
    ).resolves.toMatchObject({
      actions: [expect.objectContaining({ effect: "write" })],
    });
  });

  it("returns the full current provider catalog unless the caller requests a page", async () => {
    const request = createSubmitTurnRequest();
    const actions = Array.from({ length: 57 }, (_, index) => ({
      ...capturedExecutableOpenConnectorAction,
      description: `PostHog action ${index + 1}.`,
      id: `posthog.action_${index + 1}`,
      name: `Action ${index + 1}`,
    }));
    const tools = getRemoteAgentConnectorToolDefinitions({
      connectorExecution: {
        baseUrl: "https://connectors.example.test",
        fetch: vi.fn<typeof fetch>(async () =>
          Response.json({
            data: actions,
            message: "OK",
            meta: {},
            success: true,
          })
        ),
        runtimeToken: "test-runtime-token",
      },
      coreWorker: {
        centerAgentResolveConnectorConnection: vi.fn(async () =>
          connectionSelection({
            ownerDisplayName: "Ashley",
            service: "posthog",
            userId: "user_ashley",
          })
        ),
      },
      storage: await createStorage(request),
      submissionId: ACK.submissionId,
    });

    await expect(
      executeTool(tools, "openmeld_list_app_actions", {
        service: "posthog",
      })
    ).resolves.toMatchObject({
      actions: expect.arrayContaining([
        expect.objectContaining({ id: "posthog.action_57" }),
      ]),
      availableCount: 57,
      hasMore: false,
      matchingCount: 57,
      nextOffset: null,
      offset: 0,
    });
  });

  it.each([
    "requester",
    "shared",
  ] as const)("executes a generic App using the explicitly selected %s identity", async (connectionPreference) => {
    const action = {
      ...capturedExecutableOpenConnectorAction,
      effect: "read" as const,
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          data: [action],
          message: "OK",
          meta: {},
          success: true,
        })
      )
      .mockResolvedValueOnce(
        Response.json({
          data: [],
          message: "OK",
          meta: {
            actionId: action.id,
            auditPersisted: true,
            executionId: "provider-identity-test",
          },
          success: true,
        })
      );
    const select = vi.fn(async (input: { connectionPreference?: string }) =>
      connectionSelection({
        ownerDisplayName: "Chosen",
        service: "posthog",
        userId: "user_1",
        scope: input.connectionPreference === "shared" ? "shared" : "member",
      })
    );
    const tools = getRemoteAgentConnectorToolDefinitions({
      storage: await createStorage(createSubmitTurnRequest()),
      submissionId: ACK.submissionId,
      connectorExecution: {
        baseUrl: "https://connectors.example.test",
        runtimeToken: "fixture-token",
        fetch: fetchMock,
      },
      coreWorker: {
        centerAgentReadConnectorActionOperation: vi.fn(async () => ({
          operation: null,
        })),
        centerAgentResolveConnectorConnection: select,
        centerAgentRecordConnectorActionOperation: vi.fn(
          async (input: { outcome: string }) => ({
            attribution: CONNECTOR_OPERATION_ATTRIBUTION,
            executionAllowed: input.outcome === "attempted",
            operationId: "identity-operation",
            providerExecutionId:
              input.outcome === "attempted" ? null : "provider-identity-test",
            recorded: true,
            replayed: false,
            status: input.outcome === "attempted" ? "pending" : "completed",
          })
        ) as never,
      },
    });
    const result = await executeTool(tools, "openmeld_execute_app_action", {
      service: "posthog",
      actionId: action.id,
      input: {},
      operationId: "identity-operation",
      connectionPreference,
    });
    expect(select).toHaveBeenCalledWith(
      expect.objectContaining({ connectionPreference })
    );
    expect(result).toMatchObject({
      attribution: {
        scope: connectionPreference === "shared" ? "shared" : "member",
      },
    });
    const expectedName = connectionSelection({
      ownerDisplayName: "Chosen",
      service: "posthog",
      userId: "user_1",
      scope: connectionPreference === "shared" ? "shared" : "member",
    }).connection.connectionName;
    const calls = fetchMock.mock.calls;
    expect(JSON.stringify(calls)).toContain(expectedName);
  });

  it("runs a declared read action even when the display name does not describe the effect", async () => {
    const request = createSubmitTurnRequest({
      turnEnvelope: createRoutineTurnEnvelope({
        externalActionPolicy: "read_only",
      }),
    });
    const action = {
      ...capturedExecutableOpenConnectorAction,
      effect: "read" as const,
      name: "Projects",
    };
    const operationId = "routine-posthog-list-projects";
    const providerExecutionId = "provider-execution-1";
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          data: [action],
          message: "OK",
          meta: {},
          success: true,
        })
      )
      .mockResolvedValueOnce(
        Response.json({
          data: [{ id: 1, name: "OpenMeld" }],
          message: "OK",
          meta: {
            actionId: action.id,
            auditPersisted: true,
            executionId: providerExecutionId,
          },
          success: true,
        })
      );
    const centerAgentResolveConnectorConnection = vi.fn(async () =>
      connectionSelection({
        ownerDisplayName: "Mira",
        scope: "shared",
        service: "posthog",
        userId: "user_mira",
      })
    );
    const centerAgentReadConnectorActionOperation = vi.fn(async () => ({
      operation: null,
    }));
    const centerAgentRecordConnectorActionOperation = vi.fn(
      async (entry: { outcome: string }) => ({
        attribution: CONNECTOR_OPERATION_ATTRIBUTION,
        executionAllowed: entry.outcome === "attempted",
        operationId,
        providerExecutionId:
          entry.outcome === "attempted" ? null : providerExecutionId,
        recorded: true,
        replayed: false,
        status: entry.outcome === "attempted" ? "pending" : "completed",
      })
    );
    const tools = getRemoteAgentConnectorToolDefinitions({
      connectorExecution: {
        baseUrl: "https://connectors.example.test",
        fetch: fetchMock,
        runtimeToken: "test-runtime-token",
      },
      coreWorker: {
        centerAgentReadConnectorActionOperation:
          centerAgentReadConnectorActionOperation as never,
        centerAgentRecordConnectorActionOperation:
          centerAgentRecordConnectorActionOperation as never,
        centerAgentResolveConnectorConnection,
      },
      storage: await createStorage(request),
      submissionId: ACK.submissionId,
    });

    await expect(
      executeTool(tools, "openmeld_execute_app_action", {
        actionId: action.id,
        input: {},
        operationId,
        service: "posthog",
      })
    ).resolves.toMatchObject({
      actionId: action.id,
      attribution: {
        scope: "shared",
        selection: "shared",
        service: "posthog",
      },
      data: [{ id: 1, name: "OpenMeld" }],
      replayed: false,
    });
    expect(centerAgentResolveConnectorConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        requesterUserId:
          request.turnEnvelope.sender.kind === "routine"
            ? request.turnEnvelope.sender.delegatedBy?.ownerUserId
            : null,
        service: "posthog",
      })
    );
    expect(
      centerAgentRecordConnectorActionOperation.mock.calls.map(
        ([entry]) => entry.outcome
      )
    ).toEqual(["attempted", "completed"]);
    expect(centerAgentRecordConnectorActionOperation).toHaveBeenLastCalledWith(
      expect.objectContaining({
        operationId,
        providerExecutionId,
      })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://connectors.example.test/v1/actions/posthog.list_projects",
      expect.objectContaining({
        body: JSON.stringify({
          connectionName: "org_aaaaaaaaaaaaaaaaaa__shared__posthog",
          input: {},
        }),
        headers: {
          authorization: "Bearer test-runtime-token",
          "content-type": "application/json",
          "idempotency-key": operationId,
        },
      })
    );
  });

  it("blocks external App writes for a read-only Routine before claiming an operation", async () => {
    const action = {
      ...capturedExecutableOpenConnectorAction,
      effect: "write" as const,
      id: "posthog.get_project",
      name: "Get project",
    };
    const unspecifiedAction = {
      ...capturedExecutableOpenConnectorAction,
      effect: undefined,
      id: "posthog.get_project_without_effect",
      name: "Get project without declared effect",
    };
    const fetchMock = vi.fn<typeof fetch>((url) => {
      if (String(url).includes("/v1/actions?service=posthog")) {
        return Promise.resolve(
          Response.json({
            data: [action, unspecifiedAction],
            message: "OK",
            meta: {},
            success: true,
          })
        );
      }
      return Promise.resolve(
        Response.json({
          data: { updated: true },
          message: "OK",
          meta: {
            actionId: action.id,
            auditPersisted: true,
            executionId: "provider-update-posthog-project",
          },
          success: true,
        })
      );
    });
    const centerAgentReadConnectorActionOperation = vi.fn(async () => ({
      operation: null,
    }));
    const centerAgentRecordConnectorActionOperation = vi.fn();
    const centerAgentResolveConnectorConnection = vi.fn(async () =>
      connectionSelection({
        ownerDisplayName: "Mira",
        scope: "shared",
        service: "posthog",
        userId: "user_mira",
      })
    );
    const tools = getRemoteAgentConnectorToolDefinitions({
      connectorExecution: {
        baseUrl: "https://connectors.example.test",
        fetch: fetchMock,
        runtimeToken: "test-runtime-token",
      },
      coreWorker: {
        centerAgentReadConnectorActionOperation:
          centerAgentReadConnectorActionOperation as never,
        centerAgentRecordConnectorActionOperation:
          centerAgentRecordConnectorActionOperation as never,
        centerAgentResolveConnectorConnection,
      },
      storage: await createStorage(
        createSubmitTurnRequest({
          turnEnvelope: createRoutineTurnEnvelope({
            externalActionPolicy: "read_only",
          }),
        })
      ),
      submissionId: ACK.submissionId,
    });

    await expect(
      executeTool(tools, "openmeld_execute_app_action", {
        actionId: action.id,
        input: { name: "Reply" },
        operationId: "routine-read-only-update-project",
        service: "posthog",
      })
    ).resolves.toMatchObject({
      reasonCode: "routine_external_write_unsupported",
      sideEffects: 0,
      status: "routine_external_write_unsupported",
    });
    await expect(
      executeTool(tools, "openmeld_execute_app_action", {
        actionId: unspecifiedAction.id,
        input: {},
        operationId: "routine-read-only-unspecified-project-operation",
        service: "posthog",
      })
    ).resolves.toMatchObject({
      reasonCode: "routine_external_write_unsupported",
      sideEffects: 0,
      status: "routine_external_write_unsupported",
    });
    expect(centerAgentReadConnectorActionOperation).not.toHaveBeenCalled();
    expect(centerAgentRecordConnectorActionOperation).not.toHaveBeenCalled();
    expect(centerAgentResolveConnectorConnection).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("replays an existing Routine App operation using the catalog's trusted effect", async () => {
    const request = createSubmitTurnRequest({
      turnEnvelope: createRoutineTurnEnvelope(),
    });
    const action = capturedExecutableOpenConnectorAction;
    const operationId = "routine-posthog-list-projects-replay";
    const replayWindowRemainingMs = 24 * 60 * 60 * 1000;
    const providerExecutionId = "provider-execution-routine-replay";
    const connectionName = "org_aaaaaaaaaaaaaaaaaa__shared__posthog";
    const fetchMock = vi.fn<typeof fetch>((url) => {
      if (String(url).includes("/v1/actions?service=posthog")) {
        return Promise.resolve(
          Response.json({
            success: true,
            message: "OK",
            data: [action],
            meta: {},
          })
        );
      }
      if (String(url).endsWith(`/v1/actions/${action.id}`)) {
        return Promise.resolve(
          Response.json({
            data: [{ id: 1, name: "OpenMeld" }],
            message: "OK",
            meta: {
              actionId: action.id,
              auditPersisted: true,
              executionId: providerExecutionId,
            },
            success: true,
          })
        );
      }
      throw new Error(`The current action catalog is unavailable: ${url}`);
    });
    const centerAgentReadConnectorActionOperation = vi.fn(async () => ({
      operation: {
        replayWindowRemainingMs,
        actionId: action.id,
        connectionName,
        executionConnection: {
          connectionName,
          ownerDisplayName: "Mira",
          ownerUserId: "user_mira",
          scope: "shared" as const,
          service: "posthog" as const,
        },
        operationId,
        service: "posthog" as const,
        status: "pending" as const,
      },
    }));
    const centerAgentRecordConnectorActionOperation = vi.fn(
      async (entry: { outcome: string }) => ({
        replayWindowRemainingMs,
        executionAllowed: entry.outcome === "attempted",
        attribution: CONNECTOR_OPERATION_ATTRIBUTION,
        executionConnection: {
          connectionName,
          ownerDisplayName: "Mira",
          ownerUserId: "user_mira",
          scope: "shared" as const,
          service: "posthog" as const,
        },
        operationId,
        providerExecutionId:
          entry.outcome === "attempted" ? null : providerExecutionId,
        recorded: true,
        replayed: entry.outcome === "attempted",
        status: entry.outcome === "attempted" ? "pending" : "completed",
      })
    );
    const centerAgentResolveConnectorConnection = vi.fn();
    const tools = getRemoteAgentConnectorToolDefinitions({
      connectorExecution: {
        baseUrl: "https://connectors.example.test",
        fetch: fetchMock,
        runtimeToken: "test-runtime-token",
      },
      coreWorker: {
        centerAgentReadConnectorActionOperation:
          centerAgentReadConnectorActionOperation as never,
        centerAgentRecordConnectorActionOperation:
          centerAgentRecordConnectorActionOperation as never,
        centerAgentResolveConnectorConnection,
      },
      storage: await createStorage(request),
      submissionId: ACK.submissionId,
    });

    const replay = await executeTool(tools, "openmeld_execute_app_action", {
      actionId: action.id,
      input: {},
      operationId,
      service: "posthog",
    });
    expect(replay).toMatchObject({
      actionId: action.id,
      attribution: {
        connectionName,
        connectionOwner: {
          displayName: "Mira",
          userId: "user_mira",
        },
        scope: "shared",
        service: "posthog",
      },
      data: [{ id: 1, name: "OpenMeld" }],
      operationId,
      providerExecutionId,
      replayed: true,
    });
    expect(replay).toHaveProperty("outputSchema", action.outputSchema);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(centerAgentReadConnectorActionOperation).toHaveBeenCalledTimes(1);
    expect(centerAgentResolveConnectorConnection).not.toHaveBeenCalled();
  });

  it("reuses a completed Linear issue receipt without repeating the provider write", async () => {
    const base = createSubmitTurnRequest();
    const request = createSubmitTurnRequest({
      turnEnvelope: {
        ...base.turnEnvelope,
        space: {
          ...base.turnEnvelope.space,
          kind: "space",
          isCenterAgentDm: false,
        },
        trigger: { source: "space_wake" },
      },
    });
    const operationId = "linear-create-payment-issue";
    const connectionName =
      "org_aaaaaaaaaaaaaaaaaa__user_bbbbbbbbbbbbbbbbbb__linear";
    const receipt = {
      id: "73c7947f-5bba-4e67-a668-9392b70cd424",
      identifier: "PAY-82",
      teamId: "a86813e7-c458-4af2-8cfa-73a796d81201",
      provider: "linear" as const,
      url: "https://linear.app/acme/issue/PAY-82/fix-payment-retry",
      lastObservedAt: null,
      lastObservedState: null,
    };
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json({
        ...openConnectorRuntimeActions,
        data: [
          {
            ...capturedExecutableOpenConnectorAction,
            id: "linear.create_linear_issue",
            service: "linear",
            inputSchema: linearIssueCreateInputSchema,
            effect: "write",
            operationType: "write",
          },
        ],
      })
    );
    const record = vi.fn(
      async (): Promise<CenterAgentRecordConnectorActionOperationResponse> => ({
        attribution: CONNECTOR_OPERATION_ATTRIBUTION,
        operationId,
        providerExecutionId: "provider-linear-1",
        recorded: true,
        replayed: true,
        status: "completed" as const,
        executionAllowed: false,
      })
    );
    const completedOperation = {
      actionId: "linear.create_linear_issue",
      connectionName,
      createdAtMs: TEST_NOW_MS - 3 * 24 * 60 * 60 * 1000,
      executionConnection: {
        connectionName,
        ownerDisplayName: "Felix",
        ownerUserId: "user_1",
        scope: "member",
        service: "linear",
      },
      linearIssueReceipt: receipt,
      operationId,
      providerExecutionId: "provider-linear-1",
      service: "linear",
      status: "completed",
    };
    const read = vi.fn(async () => ({ operation: completedOperation }));
    const listSpaceTasks = vi.fn();
    const mutateSpaceTask = vi.fn();
    const tools = getRemoteAgentConnectorToolDefinitions({
      connectorExecution: {
        baseUrl: "https://connectors.example.test",
        fetch: fetchMock,
        runtimeToken: "test-runtime-token",
      },
      coreWorker: {
        centerAgentReadConnectorActionOperation: read as never,
        centerAgentRecordConnectorActionOperation: record as never,
        listSpaceTasks,
        mutateSpaceTask,
      },
      storage: await createStorage(request),
      submissionId: ACK.submissionId,
    });
    const result = await executeTool(tools, "openmeld_execute_app_action", {
      actionId: "linear.create_linear_issue",
      input: { team_id: receipt.teamId, title: "Fix payment retry" },
      operationId,
      service: "linear",
    });
    expect(result).toMatchObject({
      data: {
        id: receipt.id,
        identifier: receipt.identifier,
        ticket_url: receipt.url,
      },
      replayed: true,
    });
    expect(
      fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")
    ).toHaveLength(0);
    expect(listSpaceTasks).not.toHaveBeenCalled();
    expect(mutateSpaceTask).not.toHaveBeenCalled();
    expect(record).toHaveBeenCalledOnce();
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "attempted" })
    );
    read.mockResolvedValueOnce({
      operation: {
        ...completedOperation,
        createdAtMs: Date.now() - 24 * 60 * 60 * 1000,
        operationId: "linear-old-pending",
        status: "pending",
      },
    });
    record.mockResolvedValueOnce({
      attribution: CONNECTOR_OPERATION_ATTRIBUTION,
      operationId: "linear-old-pending",
      providerExecutionId: null,
      recorded: true,
      replayed: true,
      status: "pending",
      executionAllowed: false,
      replayWindowRemainingMs: 0,
    });
    await expect(
      executeTool(tools, "openmeld_execute_app_action", {
        actionId: "linear.create_linear_issue",
        input: { team_id: receipt.teamId, title: "Fix payment retry" },
        operationId: "linear-old-pending",
        service: "linear",
      })
    ).rejects.toMatchObject({
      result: { status: "outcome_unknown", replay: { allowed: false } },
    });
    expect(
      fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")
    ).toHaveLength(0);
  });

  it("saves the exact Linear issue reference with the completed operation", async () => {
    const storage = await createStorage(createSubmitTurnRequest());
    const issue = {
      id: "73c7947f-5bba-4e67-a668-9392b70cd424",
      identifier: "PAY-82",
      ticket_url: "https://linear.app/acme/issue/PAY-82/fix-payment-retry",
    };
    const teamId = "a86813e7-c458-4af2-8cfa-73a796d81201";
    const record = vi.fn(async () => ({
      attribution: CONNECTOR_OPERATION_ATTRIBUTION,
      operationId: "linear-create-payment-issue",
      providerExecutionId: "provider-linear-1",
      recorded: true,
      replayed: false,
      status: "completed" as const,
    }));
    const toolContext = await buildRemoteAgentToolContext({
      storage,
      submissionId: ACK.submissionId,
      toolName: "openmeld_execute_app_action",
    });
    await runAndFinalizeConnectorAction({
      connectionName: "linear-test",
      dependencies: {
        connectorExecution: {
          baseUrl: "https://connectors.example.test",
          fetch: vi.fn<typeof fetch>(async () =>
            Response.json({
              data: issue,
              message: "OK",
              meta: {
                actionId: "linear.create_linear_issue",
                auditPersisted: true,
                executionId: "provider-linear-1",
              },
              success: true,
            })
          ),
          runtimeToken: "test-runtime-token",
        },
        coreWorker: {
          centerAgentRecordConnectorActionOperation: record as never,
        },
        storage,
        submissionId: ACK.submissionId,
      },
      request: {
        actionId: "linear.create_linear_issue",
        input: { team_id: teamId, title: "Fix payment retry" },
        operationId: "linear-create-payment-issue",
        service: "linear",
      },
      requestSignature: "c".repeat(64),
      toolContext,
    });
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        linearIssueReceipt: {
          id: issue.id,
          identifier: issue.identifier,
          teamId,
          provider: "linear",
          url: issue.ticket_url,
          lastObservedAt: null,
          lastObservedState: null,
        },
        outcome: "completed",
      })
    );
  });

  it("requires a separate interactive confirmation before a discovered delete action", async () => {
    const request = createSubmitTurnRequest({
      messages: [{ content: "Delete PostHog project 42.", role: "user" }],
    });
    const action = {
      ...capturedExecutableOpenConnectorAction,
      description: "Delete one project.",
      id: "posthog.delete_project",
      name: "Delete project",
    };
    const fetchMock = vi.fn<typeof fetch>((url) => {
      if (String(url).includes("/v1/actions?service=posthog")) {
        return Promise.resolve(
          Response.json({
            data: [action],
            message: "OK",
            meta: {},
            success: true,
          })
        );
      }
      if (String(url).endsWith(`/v1/actions/${action.id}`)) {
        return Promise.resolve(
          Response.json({
            data: { deleted: true },
            message: "OK",
            meta: {
              actionId: action.id,
              auditPersisted: true,
              executionId: "provider-delete-1",
            },
            success: true,
          })
        );
      }
      throw new Error(`Unexpected connector URL: ${String(url)}`);
    });
    const centerAgentRecordConnectorActionOperation = vi.fn();
    const centerAgentReadConnectorActionOperation = vi.fn(async () => ({
      operation: null,
    }));
    const tools = getRemoteAgentConnectorToolDefinitions({
      connectorExecution: {
        baseUrl: "https://connectors.example.test",
        fetch: fetchMock,
        runtimeToken: "test-runtime-token",
      },
      coreWorker: {
        centerAgentReadConnectorActionOperation:
          centerAgentReadConnectorActionOperation as never,
        centerAgentRecordConnectorActionOperation:
          centerAgentRecordConnectorActionOperation as never,
        centerAgentResolveConnectorConnection: vi.fn(async () =>
          connectionSelection({
            ownerDisplayName: "Mira",
            scope: "shared",
            service: "posthog",
            userId: "user_mira",
          })
        ),
      },
      storage: await createStorage(request),
      submissionId: ACK.submissionId,
    });
    const definition = tools.find(
      (tool) => tool.name === "openmeld_execute_app_action"
    );

    const result = await executeTool(tools, "openmeld_execute_app_action", {
      actionId: action.id,
      input: { projectId: "42" },
      operationId: "delete-posthog-project-42",
      service: "posthog",
    });

    expect(result).toMatchObject({
      sideEffects: 0,
      status: "destructive_action_preview",
    });
    expect(definition?.endsTurnAfter?.(result)).not.toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(centerAgentRecordConnectorActionOperation).not.toHaveBeenCalled();
  });

  it.each([
    {
      operationType: "destructive" as const,
      id: "posthog.delete_project",
      name: "Delete project",
    },
    {
      effect: "destructive" as const,
      id: "posthog.project_operation",
      name: "Project operation",
    },
    {
      effect: undefined,
      id: "posthog.project_operation_without_effect",
      name: "Project operation",
    },
  ])("requires confirmation for destructive App action $id", async (metadata) => {
    const action = {
      ...capturedExecutableOpenConnectorAction,
      description: "Permanently remove one project.",
      ...metadata,
    };
    const fetchMock = vi.fn<typeof fetch>((url) => {
      if (String(url).includes("/v1/actions?service=posthog")) {
        return Promise.resolve(
          Response.json({
            data: [action],
            message: "OK",
            meta: {},
            success: true,
          })
        );
      }
      throw new Error(`Unexpected connector URL: ${String(url)}`);
    });
    const centerAgentRecordConnectorActionOperation = vi.fn();
    const tools = getRemoteAgentConnectorToolDefinitions({
      connectorExecution: {
        baseUrl: "https://connectors.example.test",
        fetch: fetchMock,
        runtimeToken: "test-runtime-token",
      },
      coreWorker: {
        centerAgentReadConnectorActionOperation: vi.fn(async () => ({
          operation: null,
        })) as never,
        centerAgentRecordConnectorActionOperation:
          centerAgentRecordConnectorActionOperation as never,
        centerAgentResolveConnectorConnection: vi.fn(async () =>
          connectionSelection({
            ownerDisplayName: "Mira",
            scope: "shared",
            service: "posthog",
            userId: "user_mira",
          })
        ),
      },
      storage: await createStorage(createSubmitTurnRequest()),
      submissionId: ACK.submissionId,
    });

    await expect(
      executeTool(tools, "openmeld_execute_app_action", {
        actionId: action.id,
        input: { projectId: "42" },
        operationId: `destroy-${action.id}`,
        service: "posthog",
      })
    ).resolves.toMatchObject({
      sideEffects: 0,
      status: "destructive_action_preview",
    });
    expect(centerAgentRecordConnectorActionOperation).not.toHaveBeenCalled();
  });

  it("rejects a destructive Routine App action even when its free-text instructions request it", async () => {
    const routineInstruction = "Archive PostHog project 42.";
    const request = createSubmitTurnRequest({
      messages: [{ content: routineInstruction, role: "user" }],
      turnEnvelope: createRoutineTurnEnvelope({
        routineId: "routine_archive_posthog_project",
        routineName: "Archive PostHog project",
        runId: "routine_run_archive_posthog_project",
      }),
    });
    const action = {
      ...capturedExecutableOpenConnectorAction,
      description: "Archive one project.",
      effect: "destructive" as const,
      id: "posthog.archive_project",
      name: "Archive project",
    };
    const operationId = "routine-archive-posthog-project-42";
    const providerExecutionId = "provider-archive-posthog-project-42";
    const fetchMock = vi.fn<typeof fetch>((url) => {
      if (String(url).includes("/v1/actions?service=posthog")) {
        return Promise.resolve(
          Response.json({
            data: [action],
            message: "OK",
            meta: {},
            success: true,
          })
        );
      }
      if (String(url).endsWith(`/v1/actions/${action.id}`)) {
        return Promise.resolve(
          Response.json({
            data: { archived: true },
            message: "OK",
            meta: {
              actionId: action.id,
              auditPersisted: true,
              executionId: providerExecutionId,
            },
            success: true,
          })
        );
      }
      throw new Error(`Unexpected connector URL: ${String(url)}`);
    });
    const centerAgentRecordConnectorActionOperation = vi.fn(
      async (entry: { outcome: string }) => ({
        attribution: CONNECTOR_OPERATION_ATTRIBUTION,
        operationId,
        executionAllowed: entry.outcome === "attempted",
        providerExecutionId:
          entry.outcome === "attempted" ? null : providerExecutionId,
        recorded: true,
        replayed: false,
        status: entry.outcome === "attempted" ? "pending" : "completed",
      })
    );
    const centerAgentReadConnectorActionOperation = vi.fn(async () => ({
      operation: null,
    }));
    const tools = getRemoteAgentConnectorToolDefinitions({
      connectorExecution: {
        baseUrl: "https://connectors.example.test",
        fetch: fetchMock,
        runtimeToken: "test-runtime-token",
      },
      coreWorker: {
        centerAgentReadConnectorActionOperation:
          centerAgentReadConnectorActionOperation as never,
        centerAgentRecordConnectorActionOperation:
          centerAgentRecordConnectorActionOperation as never,
        centerAgentResolveConnectorConnection: vi.fn(async () =>
          connectionSelection({
            ownerDisplayName: "Mira",
            scope: "shared",
            service: "posthog",
            userId: "user_mira",
          })
        ),
      },
      storage: await createStorage(request),
      submissionId: ACK.submissionId,
    });

    await expect(
      executeTool(tools, "openmeld_execute_app_action", {
        actionId: action.id,
        input: { project: { id: "42" } },
        operationId,
        service: "posthog",
      })
    ).resolves.toMatchObject({
      actionId: action.id,
      reasonCode: "routine_destructive_action_unsupported",
      sideEffects: 0,
      status: "routine_destructive_action_unsupported",
    });
    expect(centerAgentRecordConnectorActionOperation).not.toHaveBeenCalled();
    expect(centerAgentReadConnectorActionOperation).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      "/v1/actions?service=posthog"
    );
  });

  it("keeps one interactive App confirmation valid when nested input keys are reordered", async () => {
    const request = createSubmitTurnRequest();
    const action = {
      ...capturedExecutableOpenConnectorAction,
      description: "Delete one project.",
      effect: "destructive" as const,
      id: "posthog.delete_project",
      name: "Delete project",
    };
    const operationId = "delete-posthog-project-42-reordered";
    const providerExecutionId = "provider-delete-posthog-project-42-reordered";
    const fetchMock = vi.fn<typeof fetch>((url) => {
      if (String(url).includes("/v1/actions?service=posthog")) {
        return Promise.resolve(
          Response.json({
            data: [action],
            message: "OK",
            meta: {},
            success: true,
          })
        );
      }
      if (String(url).endsWith(`/v1/actions/${action.id}`)) {
        return Promise.resolve(
          Response.json({
            data: { deleted: true },
            message: "OK",
            meta: {
              actionId: action.id,
              auditPersisted: true,
              executionId: providerExecutionId,
            },
            success: true,
          })
        );
      }
      throw new Error(`Unexpected connector URL: ${String(url)}`);
    });
    const centerAgentRecordConnectorActionOperation = vi.fn(
      async (entry: { outcome: string }) => ({
        attribution: CONNECTOR_OPERATION_ATTRIBUTION,
        executionAllowed: entry.outcome === "attempted",
        operationId,
        providerExecutionId:
          entry.outcome === "attempted" ? null : providerExecutionId,
        recorded: true,
        replayed: false,
        status: entry.outcome === "attempted" ? "pending" : "completed",
      })
    );
    const connectorExecution = {
      baseUrl: "https://connectors.example.test",
      fetch: fetchMock,
      runtimeToken: "test-runtime-token",
    };
    const coreWorker = {
      centerAgentReadConnectorActionOperation: vi.fn(async () => ({
        operation: null,
      })) as never,
      centerAgentRecordConnectorActionOperation:
        centerAgentRecordConnectorActionOperation as never,
      centerAgentResolveConnectorConnection: vi.fn(async () =>
        connectionSelection({
          ownerDisplayName: "Mira",
          scope: "shared",
          service: "posthog",
          userId: "user_mira",
        })
      ),
    };
    const storage = await createStorage(request);
    const firstTurnTools = getRemoteAgentConnectorToolDefinitions({
      connectorExecution,
      coreWorker,
      storage,
      submissionId: ACK.submissionId,
    });
    const firstResult = await executeTool(
      firstTurnTools,
      "openmeld_execute_app_action",
      {
        actionId: action.id,
        input: { force: true, project: { id: "42", workspace: "alpha" } },
        operationId,
        service: "posthog",
      }
    );
    const nextTurnTools = await createNextTurnConnectorTools({
      connectorExecution,
      coreWorker,
      request,
      storage,
    });

    await expect(
      executeTool(nextTurnTools, "openmeld_execute_app_action", {
        actionId: action.id,
        destructiveConfirmationToken:
          requireDestructiveConfirmationToken(firstResult),
        input: { project: { workspace: "alpha", id: "42" }, force: true },
        operationId,
        service: "posthog",
      })
    ).resolves.toMatchObject({
      actionId: action.id,
      data: { deleted: true },
      operationId,
      providerExecutionId,
    });
    expect(centerAgentRecordConnectorActionOperation).toHaveBeenCalledTimes(2);
  });

  it("replays the same provider operation after Core finalization is interrupted", async () => {
    const request = createSubmitTurnRequest();
    const action = {
      ...capturedExecutableOpenConnectorAction,
      effect: "read" as const,
    };
    const operationId = "member-posthog-list-projects";
    const providerExecutionId = "provider-execution-1";
    const fetchMock = vi.fn<typeof fetch>((_url, init) =>
      Promise.resolve(
        init?.method === "GET"
          ? Response.json({
              data: [action],
              message: "OK",
              meta: {},
              success: true,
            })
          : Response.json({
              data: [{ id: 1, name: "OpenMeld" }],
              message: "OK",
              meta: {
                actionId: action.id,
                auditPersisted: true,
                executionId: providerExecutionId,
              },
              success: true,
            })
      )
    );
    const connectionName =
      "org_aaaaaaaaaaaaaaaaaa__user_bbbbbbbbbbbbbbbbbb__posthog";
    const centerAgentReadConnectorActionOperation = vi
      .fn()
      .mockResolvedValueOnce({ operation: null })
      .mockResolvedValue({
        operation: {
          actionId: action.id,
          connectionName,
          operationId,
          service: "posthog",
          status: "pending",
          replayWindowRemainingMs: 24 * 60 * 60 * 1000,
        },
      });
    const centerAgentRecordConnectorActionOperation = vi
      .fn()
      .mockResolvedValueOnce({
        attribution: CONNECTOR_OPERATION_ATTRIBUTION,
        operationId,
        providerExecutionId: null,
        recorded: true,
        replayed: false,
        status: "pending",
      })
      .mockRejectedValueOnce(new Error("Core operation store unavailable"))
      .mockResolvedValueOnce({
        attribution: CONNECTOR_OPERATION_ATTRIBUTION,
        operationId,
        providerExecutionId: null,
        recorded: true,
        replayed: true,
        replayWindowRemainingMs: 24 * 60 * 60 * 1000,
        status: "pending",
      })
      .mockResolvedValueOnce({
        attribution: CONNECTOR_OPERATION_ATTRIBUTION,
        operationId,
        providerExecutionId,
        recorded: true,
        replayed: false,
        status: "completed",
      });
    const centerAgentResolveConnectorConnection = vi.fn(async () =>
      connectionSelection({
        ownerDisplayName: "Ashley",
        service: "posthog",
        userId: "user_ashley",
      })
    );
    const tools = getRemoteAgentConnectorToolDefinitions({
      connectorExecution: {
        baseUrl: "https://connectors.example.test",
        fetch: fetchMock,
        runtimeToken: "test-runtime-token",
      },
      coreWorker: {
        centerAgentReadConnectorActionOperation:
          centerAgentReadConnectorActionOperation as never,
        centerAgentRecordConnectorActionOperation:
          centerAgentRecordConnectorActionOperation as never,
        centerAgentResolveConnectorConnection,
      },
      storage: await createStorage(request),
      submissionId: ACK.submissionId,
    });

    const toolInput = {
      actionId: action.id,
      input: {},
      operationId,
      service: "posthog",
    };
    await expect(
      executeTool(tools, "openmeld_execute_app_action", toolInput)
    ).rejects.toMatchObject({
      result: {
        message: expect.stringContaining(
          `Original operationId: ${operationId}`
        ),
        executionConfirmation: "executed",
      },
    });
    await expect(
      executeTool(tools, "openmeld_execute_app_action", toolInput)
    ).resolves.toMatchObject({
      data: [{ id: 1, name: "OpenMeld" }],
      operationId,
      providerExecutionId,
      replayed: true,
    });

    expect(fetchMock).toHaveBeenCalledTimes(4);
    for (const callNumber of [2, 4]) {
      expect(fetchMock).toHaveBeenNthCalledWith(
        callNumber,
        "https://connectors.example.test/v1/actions/posthog.list_projects",
        expect.objectContaining({
          body: JSON.stringify({
            connectionName,
            input: {},
          }),
          headers: {
            authorization: "Bearer test-runtime-token",
            "content-type": "application/json",
            "idempotency-key": operationId,
          },
        })
      );
    }
    expect(centerAgentReadConnectorActionOperation).toHaveBeenCalledTimes(3);
    expect(centerAgentResolveConnectorConnection).toHaveBeenCalledTimes(1);
    expect(centerAgentRecordConnectorActionOperation).toHaveBeenCalledTimes(4);
    expect(
      centerAgentRecordConnectorActionOperation.mock.calls.map(
        ([entry]) => entry.outcome
      )
    ).toEqual(["attempted", "completed", "attempted", "completed"]);
    expect(
      centerAgentRecordConnectorActionOperation.mock.calls.map(
        ([entry]) => entry.requestSignature
      )
    ).toEqual([
      "395ca26660f87317fd3e90410d287534954369ca0f15e0718c2bafd944ad8310",
      "395ca26660f87317fd3e90410d287534954369ca0f15e0718c2bafd944ad8310",
      "395ca26660f87317fd3e90410d287534954369ca0f15e0718c2bafd944ad8310",
      "395ca26660f87317fd3e90410d287534954369ca0f15e0718c2bafd944ad8310",
    ]);
  });

  it("lets a pending read retry without claiming that a write may have succeeded", async () => {
    const request = createSubmitTurnRequest();
    const action = {
      ...capturedExecutableOpenConnectorAction,
      effect: "read" as const,
    };
    const operationId = "member-posthog-pending-operation";
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          data: [action],
          message: "OK",
          meta: {},
          success: true,
        })
      )
      .mockResolvedValueOnce(
        Response.json(
          {
            data: null,
            errorCode: "idempotency_request_in_progress",
            message:
              "A request with this Idempotency-Key is still in progress.",
            meta: { actionId: action.id },
            success: false,
          },
          { status: 409 }
        )
      );
    const centerAgentRecordConnectorActionOperation = vi.fn(async () => ({
      attribution: CONNECTOR_OPERATION_ATTRIBUTION,
      operationId,
      providerExecutionId: null,
      recorded: true,
      replayed: false,
      status: "pending",
    }));
    const tools = getRemoteAgentConnectorToolDefinitions({
      connectorExecution: {
        baseUrl: "https://connectors.example.test",
        fetch: fetchMock,
        runtimeToken: "test-runtime-token",
      },
      coreWorker: {
        centerAgentReadConnectorActionOperation: vi.fn(async () => ({
          operation: null,
        })),
        centerAgentRecordConnectorActionOperation:
          centerAgentRecordConnectorActionOperation as never,
        centerAgentResolveConnectorConnection: vi.fn(async () =>
          connectionSelection({
            ownerDisplayName: "Ashley",
            service: "posthog",
            userId: "user_ashley",
          })
        ),
      },
      storage: await createStorage(request),
      submissionId: ACK.submissionId,
    });

    await expect(
      executeTool(tools, "openmeld_execute_app_action", {
        actionId: action.id,
        input: {},
        operationId,
        service: "posthog",
      })
    ).rejects.toMatchObject({
      name: "OpenConnectorOperationPendingError",
      message: expect.stringContaining("still processing the original request"),
    });
    expect(centerAgentRecordConnectorActionOperation).toHaveBeenCalledTimes(1);
    expect(centerAgentRecordConnectorActionOperation).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "attempted" })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://connectors.example.test/v1/actions/posthog.list_projects",
      expect.objectContaining({
        headers: {
          authorization: "Bearer test-runtime-token",
          "content-type": "application/json",
          "idempotency-key": operationId,
        },
      })
    );
  });
});

function requireMemberSender(
  sender: ReturnType<typeof createSubmitTurnRequest>["turnEnvelope"]["sender"]
) {
  if (sender.kind !== "member") {
    throw new Error("Expected the test fixture to use a member sender");
  }
  return sender;
}

async function createStorage(
  request: ReturnType<typeof createSubmitTurnRequest>
) {
  const storage = new InMemoryDurableObjectStorage();
  await putRemoteAgentCallbackContext(
    storage,
    createRemoteAgentCallbackContext({
      ack: ACK,
      nowMs: TEST_NOW_MS,
      request,
    })
  );
  return storage;
}

let nextTurnSequence = 0;

async function createNextTurnConnectorTools(input: {
  connectorExecution: NonNullable<
    Parameters<
      typeof getRemoteAgentConnectorToolDefinitions
    >[0]["connectorExecution"]
  >;
  coreWorker: Parameters<
    typeof getRemoteAgentConnectorToolDefinitions
  >[0]["coreWorker"];
  request: ReturnType<typeof createSubmitTurnRequest>;
  storage: InMemoryDurableObjectStorage;
}) {
  nextTurnSequence += 1;
  const submissionId = `flue_submission_confirmed_${nextTurnSequence}`;
  await putRemoteAgentCallbackContext(
    input.storage,
    createRemoteAgentCallbackContext({
      ack: { ...ACK, requestId: submissionId, submissionId },
      nowMs: TEST_NOW_MS + nextTurnSequence,
      request: input.request,
    })
  );
  return getRemoteAgentConnectorToolDefinitions({
    connectorExecution: input.connectorExecution,
    coreWorker: input.coreWorker,
    storage: input.storage,
    submissionId,
  });
}

function requireDestructiveConfirmationToken(result: unknown): string {
  if (!result || typeof result !== "object") {
    throw new Error("Expected an App destructive confirmation result");
  }
  const confirmation = (result as Record<string, unknown>).confirmation;
  if (!confirmation || typeof confirmation !== "object") {
    throw new Error("Expected App destructive confirmation metadata");
  }
  const token = (confirmation as Record<string, unknown>)
    .destructiveConfirmationToken;
  if (typeof token !== "string" || token.length === 0) {
    throw new Error("Expected an App destructive confirmation token");
  }
  return token;
}

function connectionSelection(input: {
  ownerDisplayName: string;
  scope?: "member" | "shared";
  service: "gmail" | "posthog" | "linear";
  userId: string;
}) {
  return {
    connection: {
      canDisconnect: false,
      connectionName:
        input.scope === "shared"
          ? `org_aaaaaaaaaaaaaaaaaa__shared__${input.service}`
          : `org_aaaaaaaaaaaaaaaaaa__user_bbbbbbbbbbbbbbbbbb__${input.service}`,
      createdAtMs: TEST_NOW_MS,
      disconnectedAtMs: null,
      organizationId: "org_123",
      ownerDisplayName: input.ownerDisplayName,
      scope: input.scope ?? "member",
      service: input.service,
      status: "active",
      updatedAtMs: TEST_NOW_MS,
      userId: input.userId,
    },
    selection:
      input.scope === "shared" ? ("shared" as const) : ("requester" as const),
  };
}

async function executeTool(
  tools: ReturnType<typeof getRemoteAgentConnectorToolDefinitions>,
  name: RemoteAgentConnectorToolName,
  input: Record<string, unknown>
) {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) {
    throw new Error(`Missing tool ${name}`);
  }
  return await tool.execute(input);
}
