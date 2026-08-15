import { describe, expect, it, vi } from "vitest";
import {
  createRemoteAgentCallbackContext,
  putRemoteAgentCallbackContext,
} from "../agent-core/callback-context";
import {
  getRemoteAgentConnectorToolDefinitions,
  REMOTE_AGENT_CONNECTOR_TOOL_NAMES,
  type RemoteAgentConnectorToolName,
} from "../agent-core/connector-tools";
import {
  createRoutineTurnEnvelope,
  createSubmitTurnRequest,
  TEST_NOW_MS,
} from "./fixtures";
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
  it("registers discovery and execution as one shared tool surface", () => {
    const tools = getRemoteAgentConnectorToolDefinitions({
      coreWorker: {},
      storage: new InMemoryDurableObjectStorage(),
      submissionId: ACK.submissionId,
    });

    expect(tools.map((tool) => tool.name)).toEqual([
      ...REMOTE_AGENT_CONNECTOR_TOOL_NAMES,
    ]);
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
      effect: "write" as const,
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
      coreWorker: { centerAgentResolveConnectorConnection },
      storage: await createStorage(request),
      submissionId: ACK.submissionId,
    });

    await expect(
      executeTool(tools, "openmeld_list_connected_apps", {})
    ).resolves.toMatchObject({
      apps: expect.arrayContaining([
        {
          connected: true,
          name: "PostHog",
          scope: "member",
          selection: "requester",
          service: "posthog",
        },
      ]),
      github: {
        connectionStatus: "not_checked",
        instruction:
          "This Apps list never reports GitHub access. For a GitHub request, call the matching github_* tool; it will verify the requested Organization or member GitHub connection.",
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
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json(openConnectorRuntimeActions)
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
                effect: "read",
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
  });

  it("returns the action output contract with paginated provider data", async () => {
    const request = createSubmitTurnRequest();
    const action = {
      ...capturedExecutableOpenConnectorAction,
      description:
        "List or count Gmail messages with Gmail search filters, including unread inbox messages.",
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
    const fetchMock = vi.fn<typeof fetch>((url) => {
      if (String(url).endsWith("/v1/actions?service=gmail")) {
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
            message: "OK",
            meta: {
              actionId: action.id,
              auditPersisted: true,
              executionId: providerExecutionId,
            },
            outputSchema: action.outputSchema,
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
      outputSchema: action.outputSchema,
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

  it("shows a legacy destructive action as destructive when metadata conflicts", async () => {
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
      actions: [expect.objectContaining({ effect: "destructive" })],
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

  it("runs a legacy read action from its explicit action id even when the display name differs", async () => {
    const request = createSubmitTurnRequest({
      turnEnvelope: createRoutineTurnEnvelope({
        externalActionPolicy: "read_only",
      }),
    });
    const action = {
      ...capturedExecutableOpenConnectorAction,
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
          outputSchema: action.outputSchema,
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
      id: "posthog.project_operation",
      name: "Project operation",
    };
    const fetchMock = vi.fn<typeof fetch>((url) => {
      if (String(url).endsWith("/v1/actions?service=posthog")) {
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

  it("replays an existing Routine App operation without consulting the current action catalog", async () => {
    const request = createSubmitTurnRequest({
      turnEnvelope: createRoutineTurnEnvelope(),
    });
    const action = capturedExecutableOpenConnectorAction;
    const operationId = "routine-posthog-list-projects-replay";
    const providerExecutionId = "provider-execution-routine-replay";
    const connectionName = "org_aaaaaaaaaaaaaaaaaa__shared__posthog";
    const fetchMock = vi.fn<typeof fetch>((url) => {
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
            outputSchema: action.outputSchema,
            success: true,
          })
        );
      }
      throw new Error(`The current action catalog is unavailable: ${url}`);
    });
    const centerAgentReadConnectorActionOperation = vi.fn(async () => ({
      operation: {
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
      outputSchema: action.outputSchema,
      providerExecutionId,
      replayed: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(centerAgentReadConnectorActionOperation).toHaveBeenCalledTimes(1);
    expect(centerAgentResolveConnectorConnection).not.toHaveBeenCalled();
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
      if (String(url).endsWith("/v1/actions?service=posthog")) {
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
      status: "destructive_confirmation_required",
    });
    expect(definition?.endsTurnAfter?.(result)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(centerAgentRecordConnectorActionOperation).not.toHaveBeenCalled();
  });

  it.each([
    {
      id: "posthog.remove_project",
      name: "Remove project",
    },
    {
      effect: "write" as const,
      id: "posthog.delete_project",
      name: "Delete project",
    },
    {
      id: "posthog.destroy_project",
      name: "Destroy project",
    },
    {
      id: "posthog.drop_project",
      name: "Drop project",
    },
    {
      id: "posthog.erase_project",
      name: "Erase project",
    },
    {
      id: "posthog.merge_project",
      name: "Merge project",
    },
    {
      id: "posthog.purge_project",
      name: "Purge project",
    },
    {
      id: "posthog.trash_project",
      name: "Trash project",
    },
    {
      effect: "destructive" as const,
      id: "posthog.project_operation",
      name: "Project operation",
    },
  ])("requires confirmation for destructive App action $id", async (metadata) => {
    const action = {
      ...capturedExecutableOpenConnectorAction,
      description: "Permanently remove one project.",
      ...metadata,
    };
    const fetchMock = vi.fn<typeof fetch>((url) => {
      if (String(url).endsWith("/v1/actions?service=posthog")) {
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
      status: "destructive_confirmation_required",
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
      if (String(url).endsWith("/v1/actions?service=posthog")) {
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
            outputSchema: action.outputSchema,
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
      if (String(url).endsWith("/v1/actions?service=posthog")) {
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
            outputSchema: action.outputSchema,
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
    const action = capturedExecutableOpenConnectorAction;
    const operationId = "member-posthog-list-projects";
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
          outputSchema: action.outputSchema,
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
          outputSchema: action.outputSchema,
          success: true,
        })
      );
    const connectionName =
      "org_aaaaaaaaaaaaaaaaaa__user_bbbbbbbbbbbbbbbbbb__posthog";
    const centerAgentReadConnectorActionOperation = vi
      .fn()
      .mockResolvedValueOnce({ operation: null })
      .mockResolvedValueOnce({
        operation: {
          actionId: action.id,
          connectionName,
          operationId,
          service: "posthog",
          status: "pending",
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
    ).rejects.toThrow(
      `OpenConnector action ${action.id} completed at the provider, but OpenMeld could not finalize operation ${operationId}. Retry this exact action with the same operationId.`
    );
    await expect(
      executeTool(tools, "openmeld_execute_app_action", toolInput)
    ).resolves.toMatchObject({
      data: [{ id: 1, name: "OpenMeld" }],
      operationId,
      providerExecutionId,
      replayed: true,
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    for (const callNumber of [2, 3]) {
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
    expect(centerAgentReadConnectorActionOperation).toHaveBeenCalledTimes(2);
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

  it("keeps an idempotent provider request pending while OpenConnector is still running it", async () => {
    const request = createSubmitTurnRequest();
    const action = capturedExecutableOpenConnectorAction;
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
    ).rejects.toThrow(
      `OpenConnector action ${action.id} is still running. Retry this exact action later with operationId ${operationId}.`
    );
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
  service: "gmail" | "posthog";
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
