import { CENTER_AGENT_DELEGATION_COMPLETION_MODES } from "@openmeld/schemas";
import { toJsonSchema } from "@valibot/to-json-schema";
import { describe, expect, it, vi } from "vitest";
import {
  createRemoteAgentCallbackContext,
  putRemoteAgentCallbackContext,
} from "../agent-core/callback-context";
import { REMOTE_AGENT_SANDBOX_CAPABILITY_TABLE } from "../agent-core/sandbox";
import {
  REMOTE_AGENT_MEMBER_RESEARCH_TOOL_NAMES,
  REMOTE_AGENT_OPENMELD_TOOL_NAMES,
  REMOTE_AGENT_ROUTINE_HIDDEN_TOOL_NAMES,
} from "../agent-core/tools";
import { REMOTE_AGENT_CAPABILITY_DISCOVERY_TOOL_NAMES } from "../flue-adapter/capability-discovery";
import { getRemoteAgentFlueTools as buildRemoteAgentFlueTools } from "../flue-adapter/tools";
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

async function getRemoteAgentFlueTools(
  input: Omit<Parameters<typeof buildRemoteAgentFlueTools>[0], "submissionId">
) {
  return await buildRemoteAgentFlueTools({
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

describe("remote agent Flue capability inventory", () => {
  it("exposes the complete first-phase explicit tool surface", async () => {
    const tools = await getRemoteAgentFlueTools({
      coreWorker: {},
      storage: new InMemoryDurableObjectStorage(),
    });

    expect(tools.map((tool) => tool.name)).toEqual([
      ...REMOTE_AGENT_OPENMELD_TOOL_NAMES,
      ...REMOTE_AGENT_CAPABILITY_DISCOVERY_TOOL_NAMES,
      "codemode",
    ]);
    expect(tools.map((tool) => tool.name)).toContain("web_search");
    expect(tools.map((tool) => tool.name)).toContain("web_fetch");
    expect(tools.map((tool) => tool.name)).toContain("browser_read_page");
    expect(tools.map((tool) => tool.name)).toContain("browser_screenshot");
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
    const tools = await getRemoteAgentFlueTools({
      coreWorker: {
        centerAgentReadSpaceAuthoringContract: vi.fn(async () => ({
          addressingModel: "wake_reference" as const,
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
        referenceProfileIds: {
          description:
            "Every exact Human or Agent Profile ID that this Space message includes as context without assigning work. Pass an empty array only when no context-only profile is requested.",
          items: { type: "string" },
          maxItems: 25,
          type: "array",
        },
      },
      required: [
        "agentProfileIds",
        "referenceProfileIds",
        "completionMode",
        "spaceId",
        "text",
      ],
      type: "object",
    });

    await expect(
      wakeTool.run({
        input: {
          agentProfileIds: ["agt_33333333-3333-4333-8333-333333333333"],
          completionMode: "child_reports_directly",
          spaceId: "space_123",
          text: "Please review this.",
        },
      } as never)
    ).rejects.toThrow("referenceProfileIds");
    expect(centerAgentWakeAgentProfilesInSpace).not.toHaveBeenCalled();
  });

  it("exposes Codex collaboration mode on every Agent Profile runtime settings tool", async () => {
    const tools = await getRemoteAgentFlueTools({
      coreWorker: {},
      storage: new InMemoryDurableObjectStorage(),
    });

    for (const toolName of [
      "openmeld_connect_agent_profile_to_local_agent",
      "openmeld_update_agent_profile_runtime_settings",
      "openmeld_create_configured_agent_profile",
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
    const tools = await getRemoteAgentFlueTools({
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
    "web_dm",
    "space_wake",
    "slack",
  ] as const)("keeps the full existing tool surface for %s turns", async (source) => {
    const baseEnvelope = createSubmitTurnRequest().turnEnvelope;
    const tools = await getRemoteAgentFlueTools({
      coreWorker: {},
      storage: new InMemoryDurableObjectStorage(),
      turnEnvelope: {
        ...baseEnvelope,
        trigger: { source },
      },
    });

    expect(tools.map((tool) => tool.name)).toEqual([
      ...REMOTE_AGENT_OPENMELD_TOOL_NAMES,
      ...REMOTE_AGENT_CAPABILITY_DISCOVERY_TOOL_NAMES,
      "codemode",
    ]);
  });

  it("keeps task coordination available in Lark turns", async () => {
    const baseEnvelope = createSubmitTurnRequest().turnEnvelope;
    const tools = await getRemoteAgentFlueTools({
      coreWorker: {},
      storage: new InMemoryDurableObjectStorage(),
      turnEnvelope: {
        ...baseEnvelope,
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
      ...REMOTE_AGENT_OPENMELD_TOOL_NAMES,
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
    const tools = await getRemoteAgentFlueTools({
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
      ...REMOTE_AGENT_MEMBER_RESEARCH_TOOL_NAMES,
      ...REMOTE_AGENT_CAPABILITY_DISCOVERY_TOOL_NAMES,
      "codemode",
    ]);
    expect(tools.map((tool) => tool.name)).toContain(
      "openmeld_draft_org_document"
    );
    expect(tools.map((tool) => tool.name)).toContain("github_search_commits");
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
});
