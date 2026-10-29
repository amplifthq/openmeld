import { CENTER_AGENT_DELEGATION_COMPLETION_MODES } from "@openmeld/schemas";
import { toJsonSchema } from "@valibot/to-json-schema";
import { describe, expect, it, vi } from "vitest";
import {
  createRemoteAgentCallbackContext,
  putRemoteAgentCallbackContext,
} from "../agent-core/callback-context";
import { REMOTE_AGENT_SANDBOX_CAPABILITY_TABLE } from "../agent-core/sandbox";
import {
  REMOTE_AGENT_OPENMELD_TOOL_NAMES as ALL_REMOTE_AGENT_OPENMELD_TOOL_NAMES,
  REMOTE_AGENT_MEMBER_RESEARCH_TOOL_NAMES,
  REMOTE_AGENT_ROUTINE_HIDDEN_TOOL_NAMES,
} from "../agent-core/tools";
import {
  expandRemoteAgentCapabilityDependencies,
  rankRemoteAgentCapabilities,
} from "../flue-adapter/capability-catalog";
import {
  REMOTE_AGENT_CAPABILITY_DESCRIBE_TOOL_NAME,
  REMOTE_AGENT_CAPABILITY_DISCOVERY_TOOL_NAMES,
  REMOTE_AGENT_CAPABILITY_SEARCH_TOOL_NAME,
} from "../flue-adapter/capability-discovery";
import { getTestCapabilityCatalog } from "./capability-catalog.test-support";
import {
  TEST_CODE_MODE_LOADER,
  TEST_CODE_MODE_RUNTIME,
} from "./code-mode-runtime";
import {
  createRoutineTurnEnvelope,
  createSubmitTurnRequest,
  TEST_NOW_MS,
} from "./fixtures";
import { InMemoryDurableObjectStorage } from "./storage";

// Request an Agent remains held in production; retained implementations are not exposed.
const REMOTE_AGENT_OPENMELD_TOOL_NAMES =
  ALL_REMOTE_AGENT_OPENMELD_TOOL_NAMES.filter(
    (name) =>
      name !== "openmeld_get_agent_profile_creation_approval_preferences" &&
      name !== "openmeld_set_agent_profile_creation_approval_preferences"
  );

async function getCapabilityCatalogForTest(
  input: Omit<Parameters<typeof getTestCapabilityCatalog>[0], "submissionId">
) {
  return await getTestCapabilityCatalog({
    agentActivityReadEnabled: true,
    codeModeRuntime: TEST_CODE_MODE_RUNTIME,
    ...input,
    env: {
      ...input.env,
      LOADER: TEST_CODE_MODE_LOADER,
    },
    submissionId: "flue_submission_capability_inventory",
  });
}

function createOrganizationSharedTurnEnvelope() {
  const privateEnvelope = createSubmitTurnRequest().turnEnvelope;
  return {
    ...privateEnvelope,
    interactionEnvironment: "organization_shared" as const,
    space: {
      ...privateEnvelope.space,
      isCenterAgentDm: false,
      kind: "space" as const,
    },
    trigger: { source: "space_wake" as const },
  };
}

async function createCapabilityInventoryStorage(
  turnEnvelope = createSubmitTurnRequest().turnEnvelope
) {
  const request = createSubmitTurnRequest({ turnEnvelope });
  const storage = new InMemoryDurableObjectStorage();
  await putRemoteAgentCallbackContext(
    storage,
    createRemoteAgentCallbackContext({
      ack: {
        accepted: true,
        createdAt: TEST_NOW_MS,
        idempotencyKey: "remote-agent:dispatch_123",
        requestId: "flue_submission_capability_inventory",
        status: "pending",
        submissionId: "flue_submission_capability_inventory",
      },
      nowMs: TEST_NOW_MS,
      request,
    })
  );
  return storage;
}

async function runFlueTool(
  tool: Awaited<ReturnType<typeof getTestCapabilityCatalog>>[number],
  context: { input: Record<string, unknown> }
) {
  const result = await tool.run({
    data: context.input,
    log: console,
    toolCallId: "capability-test-call",
  } as never);
  if (!result || typeof result !== "object") {
    throw new Error("Expected a Flue tool output envelope.");
  }
  return result.output;
}

describe("remote agent Flue capability inventory", () => {
  it("enforces summary-only in both the direct and Code Mode catalogs", async () => {
    const turnEnvelope: ReturnType<
      typeof createSubmitTurnRequest
    >["turnEnvelope"] = createOrganizationSharedTurnEnvelope();
    turnEnvelope.trigger = {
      source: "task_continuation",
      summaryOnly: true,
      subscriptionId: "summary-1",
      delegationId: "delegation-1",
      watchedTask: { v: 1, kind: "native_delivery", deliveryId: "parent-1" },
      outcome: {
        status: "succeeded",
        errorCode: null,
        eventId: "child-1",
        occurredAtMs: TEST_NOW_MS,
        publishedSignalId: "result-1",
      },
    };
    const write = vi.fn();
    const input = {
      coreWorker: {},
      storage: await createCapabilityInventoryStorage(turnEnvelope),
      turnEnvelope,
      sandboxDefinitions: [
        {
          name: "computer_exec",
          description: "Run a command",
          input: {} as never,
          execute: write,
        },
      ],
    };
    const tools = await getCapabilityCatalogForTest(input);
    expect(tools.map((tool) => tool.name)).toEqual([
      "openmeld_report_progress",
      "openmeld_read_tool_result",
      "openmeld_read_space_context",
      "openmeld_read_space_file",
      ...REMOTE_AGENT_CAPABILITY_DISCOVERY_TOOL_NAMES,
      "codemode",
    ]);
    const codeMode = tools.find((tool) => tool.name === "codemode");
    if (!codeMode) {
      throw new Error("Missing Code Mode");
    }
    await expect(
      runFlueTool(codeMode, {
        input: {
          code: "async () => codemode.computer_exec({command: 'touch unwanted'})",
        },
      })
    ).rejects.toThrow("codemode.computer_exec is not a function");
    expect(write).not.toHaveBeenCalled();
  });
  it("exposes the complete first-phase explicit tool surface in an organization-shared turn", async () => {
    const turnEnvelope = createOrganizationSharedTurnEnvelope();
    const tools = await getCapabilityCatalogForTest({
      coreWorker: {},
      storage: await createCapabilityInventoryStorage(turnEnvelope),
      turnEnvelope,
    });

    expect(tools.map((tool) => tool.name)).toEqual([
      "openmeld_report_progress",
      "openmeld_read_tool_result",
      ...REMOTE_AGENT_OPENMELD_TOOL_NAMES,
      ...REMOTE_AGENT_CAPABILITY_DISCOVERY_TOOL_NAMES,
      "codemode",
    ]);
    expect(tools.map((tool) => tool.name)).toContain("web_search");
    expect(tools.map((tool) => tool.name)).toContain("web_fetch");
    expect(tools.map((tool) => tool.name)).toContain("browser_read_page");
    expect(tools.map((tool) => tool.name)).toContain("browser_screenshot");
    expect(
      rankRemoteAgentCapabilities(tools, "web search fetch page")
        .slice(0, 5)
        .map(({ capability }) => capability.name)
    ).toContain("browser_read_page");
    const recoveryTools = await getCapabilityCatalogForTest({
      coreWorker: {},
      storage: await createCapabilityInventoryStorage(turnEnvelope),
      turnEnvelope,
      replyRecovery: true,
    });
    expect(recoveryTools).toEqual([]);
  });

  it("describes every executable capability from the final registered turn catalog", async () => {
    const tools = await getCapabilityCatalogForTest({
      coreWorker: {},
      storage: await createCapabilityInventoryStorage(),
    });
    const describeTool = tools.find(
      (tool) => tool.name === REMOTE_AGENT_CAPABILITY_DESCRIBE_TOOL_NAME
    );
    if (!describeTool?.run) {
      throw new Error("Center Agent capability describe is unavailable.");
    }
    const executableNames = tools
      .map((tool) => tool.name)
      .filter(
        (name) =>
          name !== "codemode" &&
          !REMOTE_AGENT_CAPABILITY_DISCOVERY_TOOL_NAMES.includes(
            name as (typeof REMOTE_AGENT_CAPABILITY_DISCOVERY_TOOL_NAMES)[number]
          )
      );
    const describedCapabilities: {
      name: string;
      namespace: string;
    }[] = [];

    for (let index = 0; index < executableNames.length; index += 8) {
      const result = (await runFlueTool(describeTool, {
        input: { names: executableNames.slice(index, index + 8) },
      })) as {
        capabilities: { name: string; namespace: string }[];
        unknownNames: string[];
      };
      expect(result.unknownNames).toEqual([]);
      describedCapabilities.push(...result.capabilities);
    }

    const describedNames = describedCapabilities.map(({ name }) => name);
    const namespaceByName = new Map(
      describedCapabilities.map(({ name, namespace }) => [name, namespace])
    );
    expect(describedNames).toEqual(executableNames);
    expect(describedNames).toContain("openmeld_list_computers");
    expect(describedNames).toContain("openmeld_update_openmeld_tools");
    expect(describedNames).toContain(
      "openmeld_select_local_agent_installation"
    );
    expect(describedNames).toContain("openmeld_read_member_computers");
    expect(namespaceByName.get("openmeld_list_connected_apps")).toBe(
      "connected_apps"
    );
    expect(namespaceByName.get("openmeld_get_organization_invite_link")).toBe(
      "people_and_invitations"
    );
    expect(
      namespaceByName.get("openmeld_create_organization_invite_link")
    ).toBe("people_and_invitations");
  });

  it("finds the requester Computer diagnostics capability from a Chinese goal", async () => {
    const tools = await getCapabilityCatalogForTest({
      coreWorker: {},
      storage: await createCapabilityInventoryStorage(),
    });
    const searchTool = tools.find(
      (tool) => tool.name === REMOTE_AGENT_CAPABILITY_SEARCH_TOOL_NAME
    );
    if (!searchTool?.run) {
      throw new Error("Center Agent capability search is unavailable.");
    }

    await expect(
      runFlueTool(searchTool, {
        input: { query: "检查我的电脑和 OpenMeld 工具状态" },
      })
    ).resolves.toMatchObject({
      capabilities: expect.arrayContaining([
        expect.objectContaining({
          name: "openmeld_list_computers",
          namespace: "agents_and_computers",
        }),
      ]),
    });
  });

  it("finds the one-click OpenMeld Tools update capability from a Chinese goal", async () => {
    const tools = await getCapabilityCatalogForTest({
      coreWorker: {},
      storage: await createCapabilityInventoryStorage(),
    });
    const searchTool = tools.find(
      (tool) => tool.name === REMOTE_AGENT_CAPABILITY_SEARCH_TOOL_NAME
    );
    if (!searchTool?.run) {
      throw new Error("Center Agent capability search is unavailable.");
    }

    await expect(
      runFlueTool(searchTool, { input: { query: "帮我更新 OpenMeld 工具" } })
    ).resolves.toMatchObject({
      capabilities: expect.arrayContaining([
        expect.objectContaining({
          name: "openmeld_update_openmeld_tools",
          namespace: "agents_and_computers",
        }),
      ]),
    });
  });

  it.each([
    "调查 Center Agent 为什么失败，给我准确执行状态",
    "子报告发出后为什么停了",
    "没有自动接续",
    "task continuation failed",
    "missing child report",
  ])("finds structured Center Agent turn diagnostics: %s", async (query) => {
    const tools = await getCapabilityCatalogForTest({
      coreWorker: {},
      storage: await createCapabilityInventoryStorage(),
    });
    const searchTool = tools.find(
      (tool) => tool.name === REMOTE_AGENT_CAPABILITY_SEARCH_TOOL_NAME
    );
    if (!searchTool?.run) {
      throw new Error("Center Agent capability search is unavailable.");
    }

    await expect(
      runFlueTool(searchTool, {
        input: { query },
      })
    ).resolves.toMatchObject({
      capabilities: expect.arrayContaining([
        expect.objectContaining({
          name: "openmeld_read_center_agent_turn_diagnostics",
          namespace: "organization",
        }),
      ]),
    });
  });

  it("loads the exact member lookup prerequisite for member Computer diagnostics", () => {
    expect(
      expandRemoteAgentCapabilityDependencies(
        new Set([
          "openmeld_read_member_computers",
          "openmeld_read_member_openmeld_service_status",
        ])
      )
    ).toEqual(
      new Set([
        "openmeld_read_member_computers",
        "openmeld_read_member_openmeld_service_status",
        "openmeld_read_organization_directory",
      ])
    );
  });

  it("expands exact multi-step capability prerequisites transitively", () => {
    expect(
      expandRemoteAgentCapabilityDependencies(
        new Set([
          "openmeld_install_organization_skill",
          "openmeld_remove_project",
          "openmeld_update_project",
          "openmeld_watch_agent_task",
        ])
      )
    ).toEqual(
      new Set([
        "openmeld_install_organization_skill",
        "openmeld_remove_project",
        "openmeld_update_project",
        "openmeld_watch_agent_task",
        "openmeld_read_organization_skills",
        "openmeld_prepare_remove_project",
        "openmeld_list_projects",
        "openmeld_list_agent_tasks",
      ])
    );
  });

  it("loads one complete Agent Profile creation capability set", () => {
    expect(
      expandRemoteAgentCapabilityDependencies(
        new Set(["openmeld_create_agent_profile_request"])
      )
    ).toEqual(
      new Set([
        "openmeld_create_agent_profile_request",
        "openmeld_read_organization_directory",
        "openmeld_read_agent_profile_creation_defaults",
        "openmeld_list_hosted_models",
        "openmeld_list_local_agent_connection_candidates",
        "openmeld_list_projects",
      ])
    );
  });

  it("exposes structured Space Reference input on the direct Wake tool", async () => {
    const request = createSubmitTurnRequest();
    const storage = new InMemoryDurableObjectStorage();
    await putRemoteAgentCallbackContext(
      storage,
      createRemoteAgentCallbackContext({
        ack: {
          accepted: true,
          createdAt: TEST_NOW_MS,
          idempotencyKey: "remote-agent:dispatch_123",
          requestId: "flue_submission_capability_inventory",
          status: "pending",
          submissionId: "flue_submission_capability_inventory",
        },
        nowMs: TEST_NOW_MS,
        request,
      })
    );
    const centerAgentWakeAgentProfilesInSpace = vi.fn();
    const tools = await getCapabilityCatalogForTest({
      coreWorker: {
        centerAgentReadSpaceAuthoringContract: vi.fn(async () => ({
          addressingModel: "wake_reference_mention" as const,
          structuredMentionTargets: true as const,
          structuredReferenceTargets: true as const,
        })),
        centerAgentWakeAgentProfilesInSpace,
      },
      storage,
    });
    const wakeTool = tools.find(
      (tool) => tool.name === "openmeld_wake_agent_profiles_in_space"
    );
    if (!wakeTool?.input) {
      throw new Error("Center Agent direct Wake input schema is unavailable.");
    }

    expect(
      toJsonSchema(wakeTool.input, {
        errorMode: "ignore",
        typeMode: "input",
      })
    ).toMatchObject({
      properties: {
        agentProfileIds: {
          items: { type: "string" },
          maxItems: 25,
          minItems: 1,
          type: "array",
        },
        completionMode: {
          enum: [...CENTER_AGENT_DELEGATION_COMPLETION_MODES],
          type: "string",
        },
        mentionProfileIds: {
          description:
            "Every exact Human Profile ID this Space message should notify with a Human Mention. Pass an empty array only when no person should be notified.",
          items: { type: "string" },
          maxItems: 25,
          type: "array",
        },
        referenceProfileIds: {
          description:
            "Every exact Agent Profile ID that this Space message includes as context without assigning work. Pass an empty array only when no Agent Reference is requested.",
          items: { type: "string" },
          maxItems: 25,
          type: "array",
        },
      },
      required: [
        "agentProfileIds",
        "mentionProfileIds",
        "referenceProfileIds",
        "completionMode",
        "spaceId",
        "text",
      ],
      type: "object",
    });

    await expect(
      runFlueTool(wakeTool, {
        input: {
          agentProfileIds: ["agt_33333333-3333-4333-8333-333333333333"],
          completionMode: "child_reports_directly",
          spaceId: "space_123",
          text: "Please review this.",
        },
      })
    ).rejects.toThrow("mentionProfileIds");
    expect(centerAgentWakeAgentProfilesInSpace).not.toHaveBeenCalled();
  });

  it("exposes Codex collaboration mode on every Agent Profile runtime settings tool", async () => {
    const tools = await getCapabilityCatalogForTest({
      coreWorker: {},
      storage: new InMemoryDurableObjectStorage(),
    });

    for (const toolName of [
      "openmeld_connect_agent_profile_to_local_agent",
      "openmeld_update_agent_profile_runtime_settings",
    ]) {
      const tool = tools.find((candidate) => candidate.name === toolName);
      if (!tool?.input) {
        throw new Error(`${toolName} input schema is unavailable.`);
      }

      expect(
        toJsonSchema(tool.input, {
          errorMode: "ignore",
          typeMode: "input",
        })
      ).toMatchObject({
        properties: {
          agentControllerCollaborationMode: {
            enum: ["codex:default", "codex:plan"],
            type: "string",
          },
        },
        type: "object",
      });
    }

    const createRequestTool = tools.find(
      (candidate) => candidate.name === "openmeld_create_agent_profile_request"
    );
    if (!createRequestTool?.input) {
      throw new Error("Unified Agent Profile creation input is unavailable.");
    }
    expect(
      toJsonSchema(createRequestTool.input, {
        errorMode: "ignore",
        typeMode: "input",
      })
    ).toMatchObject({
      properties: {
        configuration: {
          properties: {
            agentControllerCollaborationMode: {
              enum: ["codex:default", "codex:plan"],
              type: "string",
            },
          },
        },
      },
    });
  });

  it("records the sandbox decisions required by the W1-P1 vetting table", () => {
    expect(REMOTE_AGENT_SANDBOX_CAPABILITY_TABLE).toEqual([
      expect.objectContaining({
        capability: "Cloudflare Sandbox filesystem and shell tools",
        decision: "enabled",
      }),
      expect.objectContaining({
        capability: "Local sandbox",
        decision: "disabled",
      }),
      expect.objectContaining({
        capability: "Host filesystem access",
        decision: "disabled",
      }),
    ]);
  });

  it("gives Routines Project tools while keeping continuation-owned task tools hidden", async () => {
    const tools = await getCapabilityCatalogForTest({
      coreWorker: {},
      storage: new InMemoryDurableObjectStorage(),
      turnEnvelope: createRoutineTurnEnvelope({
        scheduledFor: Date.UTC(2026, 6, 12, 12, 0, 0),
      }),
    });
    const names = tools.map((tool) => tool.name);

    expect(names).toContain("openmeld_get_organization_invite_link");
    expect(names).toContain("openmeld_create_organization_invite_link");
    expect(names).toContain("openmeld_read_org_documents");
    expect(names).toContain("openmeld_draft_org_document");
    expect(names).toEqual([
      "openmeld_report_progress",
      "openmeld_read_tool_result",
      ...REMOTE_AGENT_OPENMELD_TOOL_NAMES.filter(
        (name) =>
          !REMOTE_AGENT_ROUTINE_HIDDEN_TOOL_NAMES.some(
            (hiddenName) => hiddenName === name
          )
      ),
      ...REMOTE_AGENT_CAPABILITY_DISCOVERY_TOOL_NAMES,
      "codemode",
    ]);
    expect(names).toContain("openmeld_list_projects");
    expect(names).toContain("openmeld_create_project");
    expect(names).toContain("openmeld_prepare_remove_project");
    for (const slackReadToolName of [
      "openmeld_list_slack_channels",
      "openmeld_read_slack_channel_members",
      "openmeld_read_slack_channel_history",
    ] as const) {
      expect(names).toContain(slackReadToolName);
    }
    for (const hiddenName of REMOTE_AGENT_ROUTINE_HIDDEN_TOOL_NAMES) {
      expect(names).not.toContain(hiddenName);
    }
    for (const practicalCapability of [
      "web_search",
      "web_fetch",
      "browser_screenshot",
      "openmeld_post_slack_channel_message",
      "openmeld_post_space_message",
      "openmeld_wake_agent_profiles_in_space",
      "openmeld_create_space",
      "openmeld_read_member_computers",
      "openmeld_read_member_openmeld_service_status",
      "openmeld_list_projects",
      "openmeld_create_agent_profile",
      "openmeld_add_members_to_space",
      "openmeld_add_agent_profiles_to_space",
      "github_create_issue",
      "github_get_file_contents",
      "github_list_pull_request_files",
      "github_list_workflow_run_jobs",
      "github_create_or_update_file",
      "github_create_pull_request",
      "github_delete_file",
      "github_merge_pull_request",
      "openmeld_create_routine",
      "openmeld_list_routines",
    ] as const) {
      expect(names).toContain(practicalCapability);
    }
  });

  it.each([
    {
      exposesOrganizationMemoryWrite: false,
      interactionEnvironment: "requester_private",
      label: "Web DM",
      source: "web_dm",
    },
    {
      exposesOrganizationMemoryWrite: true,
      interactionEnvironment: "organization_shared",
      label: "OpenMeld Space",
      source: "space_wake",
    },
    {
      exposesOrganizationMemoryWrite: false,
      interactionEnvironment: "requester_private",
      label: "Slack DM",
      source: "slack",
    },
  ] as const)("keeps the existing tool surface for $label while scoping Organization memory by frozen environment", async ({
    exposesOrganizationMemoryWrite,
    interactionEnvironment,
    source,
  }) => {
    const baseEnvelope = createSubmitTurnRequest().turnEnvelope;
    const tools = await getCapabilityCatalogForTest({
      coreWorker: {},
      storage: new InMemoryDurableObjectStorage(),
      turnEnvelope: {
        ...baseEnvelope,
        interactionEnvironment,
        trigger: { source },
      },
    });
    const expectedOpenMeldToolNames = REMOTE_AGENT_OPENMELD_TOOL_NAMES.filter(
      (name) =>
        (source === "space_wake" ||
          name !== "openmeld_set_final_reply_mentions") &&
        (exposesOrganizationMemoryWrite ||
          name !== "openmeld_remember_for_organization")
    );

    expect(tools.map((tool) => tool.name)).toEqual([
      "openmeld_report_progress",
      "openmeld_read_tool_result",
      ...expectedOpenMeldToolNames,
      ...REMOTE_AGENT_CAPABILITY_DISCOVERY_TOOL_NAMES,
      "codemode",
    ]);
  });

  it("keeps task coordination available in Lark turns", async () => {
    const baseEnvelope = createSubmitTurnRequest().turnEnvelope;
    const tools = await getCapabilityCatalogForTest({
      coreWorker: {},
      storage: new InMemoryDurableObjectStorage(),
      turnEnvelope: {
        ...baseEnvelope,
        interactionEnvironment: "requester_private",
        space: {
          id: "lark:cli_123:oc_chat_123:om_message_123",
          name: "Lark conversation",
          kind: "space",
          isCenterAgentDm: false,
        },
        trigger: {
          source: "message_channel",
          provider: "lark",
          connectionId: "connection_123",
          conversationId: "lark:cli_123:oc_chat_123:om_message_123",
        },
      },
    });

    expect(tools.map((tool) => tool.name)).toEqual([
      "openmeld_report_progress",
      "openmeld_read_tool_result",
      ...REMOTE_AGENT_OPENMELD_TOOL_NAMES.filter(
        (name) =>
          name !== "openmeld_remember_for_organization" &&
          name !== "openmeld_set_final_reply_mentions"
      ),
      ...REMOTE_AGENT_CAPABILITY_DISCOVERY_TOOL_NAMES,
      "codemode",
    ]);
  });

  it("exposes only research and draft tools to unattended member research turns", async () => {
    const request = createSubmitTurnRequest();
    const baseEnvelope = request.turnEnvelope;
    if (baseEnvelope.sender.kind !== "member") {
      throw new Error("Expected a member sender fixture.");
    }
    const tools = await getCapabilityCatalogForTest({
      coreWorker: {},
      storage: new InMemoryDurableObjectStorage(),
      turnEnvelope: {
        ...baseEnvelope,
        sender: {
          ...baseEnvelope.sender,
          profileId: request.author.profileId ?? "missing-author-profile",
        },
        trigger: {
          source: "member_research",
          taskId: "member_research_task_1",
          subjectUserId: "user_subject",
          subjectDisplayName: "Morgan Lee",
        },
      },
    });

    expect(tools.map((tool) => tool.name)).toEqual([
      "openmeld_report_progress",
      "openmeld_read_tool_result",
      ...REMOTE_AGENT_MEMBER_RESEARCH_TOOL_NAMES,
      ...REMOTE_AGENT_CAPABILITY_DISCOVERY_TOOL_NAMES,
      "codemode",
    ]);
    expect(tools.map((tool) => tool.name)).toContain(
      "openmeld_draft_org_document"
    );
    expect(tools.map((tool) => tool.name)).toContain("github_search_commits");
    expect(tools.map((tool) => tool.name)).toContain(
      "openmeld_get_app_action_status"
    );
    expect(tools.map((tool) => tool.name)).not.toContain("github_create_issue");
    expect(tools.map((tool) => tool.name)).not.toContain(
      "openmeld_read_center_agent_activity"
    );
    expect(tools.map((tool) => tool.name)).not.toContain(
      "openmeld_read_space_context"
    );
    expect(tools.map((tool) => tool.name)).not.toContain(
      "openmeld_list_spaces"
    );
  });
  it("lets personal Agents discover App status alongside App execution", async () => {
    const tools = await getCapabilityCatalogForTest({
      personalAgent: true,
      coreWorker: {},
      storage: new InMemoryDurableObjectStorage(),
      turnEnvelope: createSubmitTurnRequest().turnEnvelope,
    });
    expect(tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining([
        "openmeld_execute_app_action",
        "openmeld_get_app_action_status",
      ])
    );
  });
});
