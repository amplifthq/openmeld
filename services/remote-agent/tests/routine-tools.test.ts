import { safeParse } from "valibot";
import { describe, expect, it, vi } from "vitest";
import {
  createRemoteAgentCallbackContext,
  putRemoteAgentCallbackContext,
  type RemoteAgentCoreWorkerBinding,
} from "../agent-core/callback-context";
import {
  getRemoteAgentOpenMeldToolDefinitions,
  type RemoteAgentOpenMeldToolName,
} from "../agent-core/tools";
import {
  createRoutineTurnEnvelope,
  createSubmitTurnRequest,
  TEST_NOW_MS,
} from "./fixtures";
import { InMemoryDurableObjectStorage } from "./storage";

const ROUTINE_MANAGEMENT_TOOL_NAMES = [
  "openmeld_create_routine",
  "openmeld_list_routines",
  "openmeld_update_routine",
  "openmeld_delete_routine",
  "openmeld_pause_routine",
  "openmeld_resume_routine",
] as const;

const ROUTINE_NON_DESTRUCTIVE_MANAGEMENT_TOOL_NAMES = [
  "openmeld_create_routine",
  "openmeld_list_routines",
  "openmeld_update_routine",
  "openmeld_pause_routine",
  "openmeld_resume_routine",
] as const;

const ACK = {
  accepted: true,
  createdAt: TEST_NOW_MS,
  idempotencyKey: "remote-agent:dispatch_123",
  requestId: "request_routine_tools",
  status: "pending",
  submissionId: "submission_routine_tools",
} as const;

describe("Remote Agent Routine management tools", () => {
  it("exposes all six tools to both interactive and Routine turns", () => {
    const baseEnvelope = createSubmitTurnRequest().turnEnvelope;
    const interactiveNames = getRemoteAgentOpenMeldToolDefinitions({
      agentActivityReadEnabled: true,
      coreWorker: {},
      storage: new InMemoryDurableObjectStorage(),
      submissionId: "submission_interactive_routine_tools",
      turnEnvelope: baseEnvelope,
    }).map((tool) => tool.name);
    const routineNames = getRemoteAgentOpenMeldToolDefinitions({
      agentActivityReadEnabled: true,
      coreWorker: {},
      storage: new InMemoryDurableObjectStorage(),
      submissionId: "submission_unattended_routine_tools",
      turnEnvelope: createRoutineTurnEnvelope(),
    }).map((tool) => tool.name);

    for (const toolName of ROUTINE_MANAGEMENT_TOOL_NAMES) {
      expect(interactiveNames).toContain(toolName);
      expect(routineNames).toContain(toolName);
    }
    expect(interactiveNames).toContain("openmeld_read_agent_activity");
    expect(routineNames).toContain("openmeld_read_agent_activity");
    expect(interactiveNames).toContain("openmeld_list_agent_activity_sessions");
    expect(routineNames).toContain("openmeld_list_agent_activity_sessions");
  });

  it("exposes explicit organization memory only to organization-shared conversations", () => {
    const baseEnvelope = createSubmitTurnRequest().turnEnvelope;
    const organizationSharedEnvelope = {
      ...baseEnvelope,
      interactionEnvironment: "organization_shared" as const,
      space: {
        ...baseEnvelope.space,
        isCenterAgentDm: false,
        kind: "space" as const,
      },
      trigger: { source: "space_wake" as const },
    };
    const organizationSharedNames = getRemoteAgentOpenMeldToolDefinitions({
      agentActivityReadEnabled: true,
      coreWorker: {},
      storage: new InMemoryDurableObjectStorage(),
      submissionId: "submission_shared_memory_tools",
      turnEnvelope: organizationSharedEnvelope,
    }).map((tool) => tool.name);
    const routineNames = getRemoteAgentOpenMeldToolDefinitions({
      agentActivityReadEnabled: true,
      coreWorker: {},
      storage: new InMemoryDurableObjectStorage(),
      submissionId: "submission_routine_memory_tools",
      turnEnvelope: createRoutineTurnEnvelope(),
    }).map((tool) => tool.name);

    expect(organizationSharedNames).toContain(
      "openmeld_remember_for_organization"
    );
    expect(routineNames).not.toContain("openmeld_remember_for_organization");
    expect(organizationSharedNames).toContain(
      "openmeld_request_member_attention"
    );
    expect(routineNames).not.toContain("openmeld_request_member_attention");
    expect(organizationSharedNames).toContain(
      "openmeld_read_center_agent_turn_diagnostics"
    );
    expect(routineNames).not.toContain(
      "openmeld_read_center_agent_turn_diagnostics"
    );

    const privateAndUnverifiedEnvelopes = [
      {
        label: "private Web DM",
        turnEnvelope: {
          ...baseEnvelope,
          interactionEnvironment: "requester_private" as const,
        },
      },
      {
        label: "private Slack DM",
        turnEnvelope: {
          ...baseEnvelope,
          interactionEnvironment: "requester_private" as const,
          trigger: { source: "slack" as const },
        },
      },
      {
        label: "private Lark DM",
        turnEnvelope: {
          ...baseEnvelope,
          interactionEnvironment: "requester_private" as const,
          trigger: {
            connectionId: "connection_1",
            conversationId: "lark:connection_1:chat_1:message_1",
            provider: "lark" as const,
            source: "message_channel" as const,
          },
        },
      },
      {
        label: "private Feishu DM",
        turnEnvelope: {
          ...baseEnvelope,
          interactionEnvironment: "requester_private" as const,
          trigger: {
            connectionId: "connection_1",
            conversationId: "feishu:connection_1:chat_1:message_1",
            provider: "feishu" as const,
            source: "message_channel" as const,
          },
        },
      },
      {
        label: "externally shared channel",
        turnEnvelope: {
          ...baseEnvelope,
          interactionEnvironment: "externally_shared" as const,
          trigger: { source: "slack" as const },
        },
      },
      {
        label: "missing frozen scope",
        turnEnvelope: baseEnvelope,
      },
      {
        label: "conflicting frozen scope",
        turnEnvelope: {
          ...organizationSharedEnvelope,
          contextScopePlan: {
            authenticationSecrets: "never_available" as const,
            interactionEnvironment: "requester_private" as const,
            memberMemory: "use_and_share" as const,
            organizationDocuments: "share_when_authorized" as const,
            organizationMemory: "share_when_authorized" as const,
            organizationSkills: "share_when_authorized" as const,
            protectedInformation: "share_when_authorized" as const,
            requesterIdentity: "verified_member" as const,
            resultAudience: "requester_only" as const,
            v: 1 as const,
          },
        },
      },
      {
        label: "unverified sender in organization-shared channel",
        turnEnvelope: {
          ...organizationSharedEnvelope,
          sender: {
            displayName: "Connected guest",
            id: "slack:T123:U_GUEST",
            kind: "member" as const,
            messageChannelIdentity: {
              connectionId: "T123",
              provider: "slack" as const,
              providerUserId: "U_GUEST",
            },
            verified: false as const,
          },
          trigger: { source: "slack" as const },
        },
      },
    ];

    for (const testCase of privateAndUnverifiedEnvelopes) {
      const names = getRemoteAgentOpenMeldToolDefinitions({
        agentActivityReadEnabled: true,
        coreWorker: {},
        storage: new InMemoryDurableObjectStorage(),
        submissionId: `submission_hidden_memory_tool_${testCase.label}`,
        turnEnvelope: testCase.turnEnvelope,
      }).map((tool) => tool.name);

      expect(names, testCase.label).not.toContain(
        "openmeld_remember_for_organization"
      );
    }
  });

  it("keeps Routine descriptions effect-focused under the Kernel policy", () => {
    const descriptions = new Map(
      getRemoteAgentOpenMeldToolDefinitions({
        coreWorker: {},
        storage: new InMemoryDurableObjectStorage(),
        submissionId: "submission_routine_descriptions",
      }).map((tool) => [tool.name, tool.description])
    );

    expect(descriptions.get("openmeld_update_routine")).toContain(
      "This is an ordinary external write"
    );
    expect(descriptions.get("openmeld_update_routine")).not.toContain(
      "is authorization"
    );
    expect(descriptions.get("openmeld_delete_routine")).toContain(
      "obtain one separate confirmation, even when the initial request was explicit"
    );
    expect(descriptions.get("openmeld_create_routine")).toContain(
      "Use current_conversation to deliver back to the Slack thread"
    );
    expect(descriptions.get("openmeld_create_routine")).toContain(
      "The required inputs are the exact Routine name, schedule, destination, and instructions"
    );
    expect(descriptions.get("openmeld_create_routine")).not.toContain(
      "is authorization"
    );
  });

  it("requires one separate interactive confirmation before deleting a Routine", async () => {
    const request = createSubmitTurnRequest({
      messages: [
        {
          content: "Delete the Morning feedback review Routine.",
          role: "user",
        },
      ],
    });
    const storage = await createStorageWithContext(request);
    const centerAgentDeleteRoutine = vi.fn();
    const centerAgentListRoutines = vi.fn(async () => ({
      ...routineListResponse(),
      routines: [
        {
          ...routineRecord(),
          name: "Morning feedback review",
        },
      ],
    }));
    const tools = getRemoteAgentOpenMeldToolDefinitions({
      coreWorker: { centerAgentDeleteRoutine, centerAgentListRoutines },
      storage,
      submissionId: ACK.submissionId,
    });
    const definition = tools.find(
      (tool) => tool.name === "openmeld_delete_routine"
    );

    const result = await executeTool(tools, "openmeld_delete_routine", {
      routineId: "routine_1",
      routineName: "Morning feedback review",
    });

    expect(result).toMatchObject({
      sideEffects: 0,
      status: "destructive_confirmation_required",
    });
    expect(definition?.endsTurnAfter?.(result)).toBe(true);
    expect(centerAgentDeleteRoutine).not.toHaveBeenCalled();

    const destructiveConfirmationToken = (
      result as {
        confirmation: { destructiveConfirmationToken: string };
      }
    ).confirmation.destructiveConfirmationToken;
    const confirmedSubmissionId = "submission_routine_delete_confirmed";
    const confirmedRequest = createSubmitTurnRequest({
      dispatchId: "dispatch_routine_delete_confirmed",
      idempotencyKey: "remote-agent:dispatch_routine_delete_confirmed",
      messages: [{ content: "Yes, delete it.", role: "user" }],
      triggerMessageId: "signal_routine_delete_confirmed",
    });
    await putRemoteAgentCallbackContext(
      storage,
      createRemoteAgentCallbackContext({
        ack: {
          ...ACK,
          requestId: confirmedSubmissionId,
          submissionId: confirmedSubmissionId,
        },
        nowMs: TEST_NOW_MS + 1000,
        request: confirmedRequest,
      })
    );
    centerAgentDeleteRoutine.mockResolvedValue({
      deleted: true,
      organizationId: "org_123",
      routineId: "routine_1",
    });
    const confirmedTools = getRemoteAgentOpenMeldToolDefinitions({
      coreWorker: { centerAgentDeleteRoutine, centerAgentListRoutines },
      storage,
      submissionId: confirmedSubmissionId,
    });

    await expect(
      executeTool(confirmedTools, "openmeld_delete_routine", {
        destructiveConfirmationToken,
        routineId: "routine_1",
        routineName: "Morning feedback review",
      })
    ).resolves.toMatchObject({ deleted: true, routineId: "routine_1" });
    expect(centerAgentDeleteRoutine).toHaveBeenCalledOnce();
  });

  it("keeps missing receivers diagnostic and rejects non-shared Core responses", async () => {
    const request = createSubmitTurnRequest();
    const storage = await createStorageWithContext(request);
    const missingReceiverTools = getRemoteAgentOpenMeldToolDefinitions({
      coreWorker: {
        centerAgentListRoutines: vi
          .fn()
          .mockRejectedValue(
            new Error(
              "The RPC receiver does not implement the method centerAgentListRoutines"
            )
          ),
      },
      storage,
      submissionId: ACK.submissionId,
    });
    await expect(
      executeTool(missingReceiverTools, "openmeld_list_routines", {})
    ).rejects.toThrow(
      "OpenMeld Core RPC centerAgentListRoutines is unavailable."
    );

    const invalidResponseTools = getRemoteAgentOpenMeldToolDefinitions({
      coreWorker: {
        centerAgentListRoutines: vi.fn().mockResolvedValue({ unknown: true }),
      },
      storage,
      submissionId: ACK.submissionId,
    });
    await expect(
      executeTool(invalidResponseTools, "openmeld_list_routines", {})
    ).rejects.toThrow(
      "OpenMeld Core RPC centerAgentListRoutines returned an invalid Routine response."
    );
  });

  it("accepts quarantine lastRun evidence but rejects other negative Runs", async () => {
    const request = createSubmitTurnRequest();
    const storage = await createStorageWithContext(request);
    const quarantineLastRun = {
      failureCode: "routine.schedule_invalid",
      failureDetail: "The stored schedule is outside the supported horizon.",
      finishedAtMs: TEST_NOW_MS,
      id: "run_quarantine",
      publishedSignalId: null,
      scheduledFor: -300_000,
      startedAtMs: TEST_NOW_MS,
      status: "skipped",
    } as const;
    const validTools = getRemoteAgentOpenMeldToolDefinitions({
      coreWorker: {
        centerAgentListRoutines: vi.fn().mockResolvedValue({
          currentUserId: "user_1",
          organizationId: "org_123",
          routines: [{ ...routineRecord(), lastRun: quarantineLastRun }],
        }),
      },
      storage,
      submissionId: ACK.submissionId,
    });
    await expect(
      executeTool(validTools, "openmeld_list_routines", {})
    ).resolves.toMatchObject({
      routines: [{ lastRun: { scheduledFor: -300_000 } }],
    });

    const invalidTools = getRemoteAgentOpenMeldToolDefinitions({
      coreWorker: {
        centerAgentListRoutines: vi.fn().mockResolvedValue({
          currentUserId: "user_1",
          organizationId: "org_123",
          routines: [
            {
              ...routineRecord(),
              lastRun: {
                ...quarantineLastRun,
                failureCode: null,
                status: "failed",
              },
            },
          ],
        }),
      },
      storage,
      submissionId: ACK.submissionId,
    });
    await expect(
      executeTool(invalidTools, "openmeld_list_routines", {})
    ).rejects.toThrow("returned an invalid Routine response");
  });

  it("derives the represented member from durable turn context for every Core RPC", async () => {
    const request = createSubmitTurnRequest();
    const storage = await createStorageWithContext(request);
    const routine = routineRecord();
    const scenarios = [
      {
        expectedInput: {},
        input: {},
        method: "centerAgentListRoutines",
        response: {
          currentUserId: "user_1",
          organizationId: "org_123",
          routines: [routine],
        },
        tool: "openmeld_list_routines",
      },
      {
        expectedInput: canonicalCreateRoutineInput(),
        input: createRoutineInput(),
        method: "centerAgentCreateRoutine",
        response: { routine },
        tool: "openmeld_create_routine",
      },
      {
        expectedInput: {
          name: "Morning feedback review",
          routineId: routine.id,
        },
        input: { name: "Morning feedback review", routineId: routine.id },
        method: "centerAgentUpdateRoutine",
        response: { routine: { ...routine, name: "Morning feedback review" } },
        tool: "openmeld_update_routine",
      },
      {
        expectedInput: { routineId: routine.id },
        input: { routineId: routine.id },
        method: "centerAgentPauseRoutine",
        response: {
          routine: { ...routine, nextDueAt: null, status: "paused" },
        },
        tool: "openmeld_pause_routine",
      },
      {
        expectedInput: { routineId: routine.id },
        input: { routineId: routine.id },
        method: "centerAgentResumeRoutine",
        response: { routine },
        tool: "openmeld_resume_routine",
      },
    ] as const;

    for (const scenario of scenarios) {
      const rpc = vi.fn(async () => scenario.response);
      const tools = getRemoteAgentOpenMeldToolDefinitions({
        coreWorker: {
          [scenario.method]: rpc,
        } as RemoteAgentCoreWorkerBinding,
        storage,
        submissionId: ACK.submissionId,
      });

      await executeTool(tools, scenario.tool, scenario.input);

      expect(rpc).toHaveBeenCalledOnce();
      expect(rpc).toHaveBeenCalledWith({
        ...scenario.expectedInput,
        context: expectedToolContext(request, scenario.tool),
        speakerMember: { memberId: "member_123", userId: "user_1" },
      });
    }
  });

  it("resolves a confirmed one-time Routine to the durable current Slack thread", async () => {
    const base = createSubmitTurnRequest();
    const request = createSubmitTurnRequest({
      turnEnvelope: {
        ...base.turnEnvelope,
        space: {
          ...base.turnEnvelope.space,
          id: "slack:T123:C456:1712345678.000100",
          name: "#product",
        },
        trigger: {
          channelId: "C456",
          channelName: "product",
          conversationId: "slack:T123:C456:1712345678.000100",
          source: "slack",
          teamId: "T123",
          threadTs: "1712345678.000100",
        },
      },
    });
    const storage = await createStorageWithContext(request);
    const routine = {
      ...routineRecord(),
      cronExpression: null,
      destinationKind: "slack_thread" as const,
      nextDueAt: TEST_NOW_MS + 3_600_000,
      runAtMs: TEST_NOW_MS + 3_600_000,
      scheduleKind: "once" as const,
      slackChannelId: "C456",
      slackConversationId: "slack:T123:C456:1712345678.000100",
      slackTeamId: "T123",
      slackThreadLabel: "#product",
      slackThreadTs: "1712345678.000100",
      targetSpaceId: null,
      timezone: null,
    };
    const rpc = vi.fn(async () => ({ routine }));
    const tools = getRemoteAgentOpenMeldToolDefinitions({
      coreWorker: { centerAgentCreateRoutine: rpc },
      storage,
      submissionId: ACK.submissionId,
    });

    await executeTool(tools, "openmeld_create_routine", {
      destinationKind: "current_conversation",
      instructions: "Post the confirmed launch reminder.",
      name: "Launch reminder",
      runAtIso: new Date(TEST_NOW_MS + 3_600_000).toISOString(),
      scheduleKind: "once",
    });

    expect(rpc).toHaveBeenCalledWith(
      expect.objectContaining({
        cronExpression: null,
        destinationKind: "slack_thread",
        runAtMs: TEST_NOW_MS + 3_600_000,
        scheduleKind: "once",
        slackChannelId: "C456",
        slackConversationId: "slack:T123:C456:1712345678.000100",
        slackTeamId: "T123",
        slackThreadLabel: "#product",
        slackThreadTs: "1712345678.000100",
        targetSpaceId: null,
        timezone: null,
      })
    );

    const updateRpc = vi.fn(async () => ({ routine }));
    const updateTools = getRemoteAgentOpenMeldToolDefinitions({
      coreWorker: { centerAgentUpdateRoutine: updateRpc },
      storage,
      submissionId: ACK.submissionId,
    });
    await executeTool(updateTools, "openmeld_update_routine", {
      destinationKind: "current_conversation",
      routineId: routine.id,
      runAtIso: new Date(TEST_NOW_MS + 7_200_000).toISOString(),
      scheduleKind: "once",
    });
    expect(updateRpc).toHaveBeenCalledWith(
      expect.objectContaining({
        cronExpression: null,
        destinationKind: "slack_thread",
        runAtMs: TEST_NOW_MS + 7_200_000,
        routineId: routine.id,
        scheduleKind: "once",
        slackConversationId: "slack:T123:C456:1712345678.000100",
        timezone: null,
      })
    );
  });

  it("preserves the current Slack thread when a Routine creates another Routine", async () => {
    const base = createRoutineTurnRequest();
    const slackConversationId = "slack:T123:C456:1712345678.000100";
    const request = createSubmitTurnRequest({
      ...base,
      turnEnvelope: createRoutineTurnEnvelope({
        destination: {
          channelId: "C456",
          conversationId: slackConversationId,
          kind: "slack_thread",
          label: "#product",
          teamId: "T123",
          threadTs: "1712345678.000100",
        },
        routineId: "routine_tools_fence",
        routineName: "Routine tools fence",
        runId: "run_routine_tools",
      }),
    });
    const storage = await createStorageWithContext(request);
    const rpc = vi.fn(async () => ({
      routine: {
        ...routineRecord(),
        destinationKind: "slack_thread" as const,
        slackChannelId: "C456",
        slackConversationId,
        slackTeamId: "T123",
        slackThreadLabel: "#product",
        slackThreadTs: "1712345678.000100",
        targetSpaceId: null,
      },
    }));
    const tools = getRemoteAgentOpenMeldToolDefinitions({
      coreWorker: { centerAgentCreateRoutine: rpc },
      storage,
      submissionId: ACK.submissionId,
    });

    await executeTool(tools, "openmeld_create_routine", {
      destinationKind: "current_conversation",
      instructions: "Post the confirmed launch reminder.",
      name: "Next launch reminder",
      runAtIso: new Date(TEST_NOW_MS + 3_600_000).toISOString(),
      scheduleKind: "once",
    });

    expect(rpc).toHaveBeenCalledWith(
      expect.objectContaining({
        destinationKind: "slack_thread",
        slackChannelId: "C456",
        slackConversationId,
        slackTeamId: "T123",
        slackThreadLabel: "#product",
        slackThreadTs: "1712345678.000100",
        targetSpaceId: null,
      })
    );
  });

  it("fails visibly instead of guessing an old-Core Routine destination", async () => {
    const envelope = createRoutineTurnEnvelope();
    if (envelope.trigger.source !== "routine") {
      throw new Error("Expected a Routine trigger");
    }
    const { destination: _destination, ...trigger } = envelope.trigger;
    const request = createSubmitTurnRequest({
      turnEnvelope: {
        ...envelope,
        trigger,
      },
    });
    const storage = await createStorageWithContext(request);
    const rpc = vi.fn();
    const tools = getRemoteAgentOpenMeldToolDefinitions({
      coreWorker: { centerAgentCreateRoutine: rpc },
      storage,
      submissionId: ACK.submissionId,
    });

    await expect(
      executeTool(tools, "openmeld_create_routine", {
        destinationKind: "current_conversation",
        instructions: "Post the confirmed launch reminder.",
        name: "Next launch reminder",
        runAtIso: new Date(TEST_NOW_MS + 3_600_000).toISOString(),
        scheduleKind: "once",
      })
    ).rejects.toThrow("does not include its durable destination");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects forged model identity fields and invalid Routine input before Core", async () => {
    const request = createSubmitTurnRequest();
    const storage = await createStorageWithContext(request);
    const coreWorker: RemoteAgentCoreWorkerBinding = {
      centerAgentCreateRoutine: vi.fn(),
      centerAgentDeleteRoutine: vi.fn(),
      centerAgentListRoutines: vi.fn(),
      centerAgentUpdateRoutine: vi.fn(),
    };
    const tools = getRemoteAgentOpenMeldToolDefinitions({
      coreWorker,
      storage,
      submissionId: ACK.submissionId,
    });
    const schemasByName = new Map(
      tools.map((tool) => [tool.name, tool.input] as const)
    );

    expect(
      safeParse(schemasByName.get("openmeld_create_routine") as never, {
        ...createRoutineInput(),
        onBehalfOf: { memberId: "member_attacker", userId: "user_attacker" },
      }).success
    ).toBe(false);
    expect(
      safeParse(schemasByName.get("openmeld_list_routines") as never, {
        ownerUserId: "user_attacker",
      }).success
    ).toBe(false);
    expect(
      safeParse(schemasByName.get("openmeld_delete_routine") as never, {
        routineId: "   ",
      }).success
    ).toBe(false);
    expect(
      safeParse(schemasByName.get("openmeld_create_routine") as never, {
        ...createRoutineInput(),
        cronExpression: "",
      }).success
    ).toBe(false);
    expect(
      safeParse(schemasByName.get("openmeld_update_routine") as never, {
        routineId: "routine_1",
      }).success
    ).toBe(true);
    await expect(
      executeTool(tools, "openmeld_update_routine", {
        routineId: "routine_1",
      })
    ).rejects.toThrow("At least one Routine field must be updated.");
    for (const rpc of Object.values(coreWorker)) {
      expect(rpc).not.toHaveBeenCalled();
    }
  });

  it.each([
    { label: "missing envelope", turnEnvelope: undefined },
    {
      label: "unverified member",
      turnEnvelope: {
        ...createSubmitTurnRequest().turnEnvelope,
        sender: {
          ...createSubmitTurnRequest().turnEnvelope.sender,
          kind: "member" as const,
          verified: false,
        },
      },
    },
    {
      label: "member without ownerUserId",
      turnEnvelope: {
        ...createSubmitTurnRequest().turnEnvelope,
        sender: {
          displayName: "Felix",
          id: "member_123",
          kind: "member" as const,
          verified: true,
        },
      },
    },
    {
      label: "Agent Profile sender",
      turnEnvelope: {
        ...createSubmitTurnRequest().turnEnvelope,
        sender: {
          displayName: "Research Agent",
          id: "agent_sender",
          kind: "agent_profile" as const,
          ownerUserId: "user_1",
          verified: true,
        },
      },
    },
    {
      label: "Routine without a delegated member",
      turnEnvelope: {
        ...createSubmitTurnRequest().turnEnvelope,
        sender: {
          createdByUserId: "user_1",
          kind: "routine" as const,
          routineId: "routine_sender",
        },
        trigger: {
          routineId: "routine_sender",
          routineName: "Sender fence",
          runId: "run_sender_fence",
          scheduledFor: TEST_NOW_MS,
          source: "routine" as const,
        },
      },
    },
  ])("fails closed before Core for a $label", async ({ turnEnvelope }) => {
    const request = createSubmitTurnRequest({
      turnEnvelope: turnEnvelope as ReturnType<
        typeof createSubmitTurnRequest
      >["turnEnvelope"],
    });
    const storage = await createStorageWithContext(request);
    const rpc = vi.fn();
    const tools = getRemoteAgentOpenMeldToolDefinitions({
      coreWorker: { centerAgentListRoutines: rpc },
      storage,
      submissionId: ACK.submissionId,
    });

    await expect(
      executeTool(tools, "openmeld_list_routines", {})
    ).rejects.toThrow(
      "Routine management tools require a verified human member speaker."
    );
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each(
    ROUTINE_NON_DESTRUCTIVE_MANAGEMENT_TOOL_NAMES
  )("allows %s at execution for a delegated Routine callback context", async (toolName) => {
    const routineRequest = createRoutineTurnRequest();
    const storage = await createStorageWithContext(routineRequest);
    const rpc = vi.fn(async () => routineToolResponse(toolName));
    const method = routineToolMethod(toolName);
    const tools = getRemoteAgentOpenMeldToolDefinitions({
      coreWorker: {
        [method]: rpc,
      } as RemoteAgentCoreWorkerBinding,
      storage,
      submissionId: ACK.submissionId,
    });
    expect(tools.map((tool) => tool.name)).toContain(toolName);

    await expect(
      executeTool(tools, toolName, routineToolInput(toolName))
    ).resolves.toBeDefined();
    expect(rpc).toHaveBeenCalledOnce();
  });

  it("rejects Routine deletion before Core even when its free-text instructions request it", async () => {
    const request = createRoutineTurnRequest(
      "Delete the Daily feedback review Routine."
    );
    const storage = await createStorageWithContext(request);
    const centerAgentDeleteRoutine = vi.fn(async () => ({
      deleted: true as const,
      organizationId: "org_123",
      routineId: "routine_1",
    }));
    const centerAgentListRoutines = vi.fn(async () => routineListResponse());
    const tools = getRemoteAgentOpenMeldToolDefinitions({
      coreWorker: { centerAgentDeleteRoutine, centerAgentListRoutines },
      storage,
      submissionId: ACK.submissionId,
    });

    await expect(
      executeTool(tools, "openmeld_delete_routine", {
        routineId: "routine_1",
        routineName: "Daily feedback review",
      })
    ).resolves.toMatchObject({
      reasonCode: "routine_destructive_action_unsupported",
      sideEffects: 0,
      status: "routine_destructive_action_unsupported",
    });
    expect(centerAgentDeleteRoutine).not.toHaveBeenCalled();
    expect(centerAgentListRoutines).not.toHaveBeenCalled();
  });
});

async function createStorageWithContext(
  request: ReturnType<typeof createSubmitTurnRequest>
): Promise<InMemoryDurableObjectStorage> {
  const storage = new InMemoryDurableObjectStorage();
  await putRemoteAgentCallbackContext(
    storage,
    createRemoteAgentCallbackContext({ ack: ACK, nowMs: TEST_NOW_MS, request })
  );
  return storage;
}

async function executeTool(
  tools: ReturnType<typeof getRemoteAgentOpenMeldToolDefinitions>,
  name: RemoteAgentOpenMeldToolName,
  input: Record<string, unknown>
) {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) {
    throw new Error(`Missing tool ${name}.`);
  }
  return await tool.execute(input);
}

function expectedToolContext(
  request: ReturnType<typeof createSubmitTurnRequest>,
  toolName: string
) {
  return {
    activeOrganizationId: request.organizationId,
    actorContext: {
      agentControllerRef: "hosted:center-agent",
      callerPrincipalId: request.agentProfileId,
      profileKind: "agent",
      requestId: `remote-agent-tool:${toolName}:${ACK.submissionId}`,
      openMeldProfileId: request.agentProfileId,
    },
    agentControllerConversationId: ACK.submissionId,
  };
}

function createRoutineInput() {
  return {
    authorizedActions: [
      "organization_documents.save_approved_knowledge" as const,
    ],
    cronExpression: "0 9 * * *",
    destinationKind: "space" as const,
    instructions: "Review new Feedback Inbox issues.",
    name: "Daily feedback review",
    scheduleKind: "cron" as const,
    targetSpaceId: "space_123",
    timezone: "America/Los_Angeles",
  };
}

function canonicalCreateRoutineInput() {
  return {
    authorizedActions: [
      "organization_documents.save_approved_knowledge" as const,
    ],
    cronExpression: "0 9 * * *",
    destinationKind: "space" as const,
    instructions: "Review new Feedback Inbox issues.",
    name: "Daily feedback review",
    runAtMs: null,
    scheduleKind: "cron" as const,
    slackChannelId: null,
    slackConversationId: null,
    slackTeamId: null,
    slackThreadLabel: null,
    slackThreadTs: null,
    targetSpaceId: "space_123",
    timezone: "America/Los_Angeles",
  };
}

function routineRecord() {
  return {
    canManage: true,
    createdAtMs: TEST_NOW_MS,
    createdByUserId: "user_1",
    cronExpression: "0 9 * * *",
    destinationKind: "space",
    id: "routine_1",
    instructions: "Review new Feedback Inbox issues.",
    lastRun: null,
    name: "Daily feedback review",
    nextDueAt: TEST_NOW_MS + 86_400_000,
    organizationId: "org_123",
    runAtMs: null,
    scheduleKind: "cron",
    slackChannelId: null,
    slackConversationId: null,
    slackTeamId: null,
    slackThreadLabel: null,
    slackThreadTs: null,
    status: "enabled",
    targetSpaceId: "space_123",
    timezone: "America/Los_Angeles",
    updatedAtMs: TEST_NOW_MS,
    updatedByUserId: "user_1",
  } as const;
}

function createRoutineTurnRequest(
  instruction = 'Delete the "Daily feedback review" Routine.'
) {
  const base = createSubmitTurnRequest();
  return createSubmitTurnRequest({
    author: {
      displayName: "Center Agent",
      profileId: base.agentProfileId,
      profileKind: "agent",
    },
    dispatchId: "run_routine_tools",
    idempotencyKey: "run_routine_tools",
    messages: [
      {
        content: instruction,
        role: "user",
      },
    ],
    onBehalfOf: null,
    sourceClientMessageId: null,
    triggerMessageId: "run_routine_tools",
    turnEnvelope: createRoutineTurnEnvelope({
      routineId: "routine_tools_fence",
      routineName: "Routine tools fence",
      runId: "run_routine_tools",
    }),
  });
}

function routineToolMethod(
  toolName: (typeof ROUTINE_MANAGEMENT_TOOL_NAMES)[number]
) {
  return {
    openmeld_create_routine: "centerAgentCreateRoutine",
    openmeld_delete_routine: "centerAgentDeleteRoutine",
    openmeld_list_routines: "centerAgentListRoutines",
    openmeld_pause_routine: "centerAgentPauseRoutine",
    openmeld_resume_routine: "centerAgentResumeRoutine",
    openmeld_update_routine: "centerAgentUpdateRoutine",
  }[toolName];
}

function routineToolInput(
  toolName: (typeof ROUTINE_MANAGEMENT_TOOL_NAMES)[number]
) {
  if (toolName === "openmeld_create_routine") {
    return createRoutineInput();
  }
  if (toolName === "openmeld_list_routines") {
    return {};
  }
  if (toolName === "openmeld_update_routine") {
    return { name: "Updated Routine", routineId: "routine_1" };
  }
  if (toolName === "openmeld_delete_routine") {
    return {
      routineId: "routine_1",
      routineName: "Daily feedback review",
    };
  }
  return { routineId: "routine_1" };
}

function routineToolResponse(
  toolName: (typeof ROUTINE_MANAGEMENT_TOOL_NAMES)[number]
) {
  const routine = routineRecord();
  switch (toolName) {
    case "openmeld_list_routines":
      return routineListResponse();
    case "openmeld_delete_routine":
      return {
        deleted: true,
        organizationId: routine.organizationId,
        routineId: routine.id,
      };
    case "openmeld_pause_routine":
      return {
        routine: { ...routine, nextDueAt: null, status: "paused" as const },
      };
    case "openmeld_update_routine":
      return { routine: { ...routine, name: "Updated Routine" } };
    default:
      return { routine };
  }
}

function routineListResponse(routines = [routineRecord()]) {
  return {
    currentUserId: "user_1",
    organizationId: "org_123",
    routines,
  };
}
