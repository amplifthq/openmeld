import { describe, expect, it, vi } from "vitest";
import { Space } from "../src/space/transport/do/space";

const CENTER_ID = "agt_center";
const SOURCE_ID = "sig-source";
const TARGET_ID = "agt_target";
const DM_CLIENT_ID = "00000000-0000-4000-8000-000000000090";

function createSpace(
  sourceProfileId: string,
  provenance: "attributed" | "unattributed" | "missing" = "attributed"
) {
  const space = Object.create(Space.prototype) as Space;
  Reflect.set(space, "spaceId", "space-1");
  Reflect.set(space, "bindings", {
    OPENMELD_DB: {
      prepare: vi.fn(() => ({
        bind: vi.fn(() => ({
          first: vi.fn(async () =>
            provenance !== "missing"
              ? {
                  action: "wake_agent_profiles_in_space",
                  actor_profile_id: CENTER_ID,
                  organization_id: "org-1",
                  resource_type: "space",
                  resource_id: "space-1",
                  on_behalf_of_profile_id:
                    provenance === "attributed" ? "human-1" : null,
                  on_behalf_of_user_id:
                    provenance === "attributed" ? "user-1" : null,
                }
              : null
          ),
        })),
      })),
    },
  });
  Reflect.set(
    space,
    "readSignalById",
    vi.fn(() => ({
      type: "signal.text",
      data: { meta: { clientMessageId: "ca-wake:message-1" } },
      profile: { kind: "agent", profileId: sourceProfileId },
    }))
  );
  return { space };
}

function requesterContext(userId = "user-1", profileId = "human-1") {
  return {
    activeOrganizationId: "org-1",
    actorContext: {
      callerPrincipalId: userId,
      ownerUserId: userId,
      openMeldProfileId: profileId,
      profileKind: "human",
      profileName: "Mira",
      requestId: "request-1",
    },
  };
}

function centerContext(profileId = CENTER_ID) {
  return {
    activeOrganizationId: "org-1",
    actorContext: {
      agentControllerRef: "hosted:center-agent",
      callerPrincipalId: profileId,
      openMeldProfileId: profileId,
      profileKind: "agent",
      profileName: "Center Agent",
      requestId: "request-1",
    },
  };
}

describe("Center Agent Wake Stop authorization", () => {
  it("lets the verified requester stop the Center-authored Wake", async () => {
    const context = requesterContext();
    const { space } = createSpace(CENTER_ID);
    const authorized = await Reflect.get(space, "isWakeStopAuthorized").call(
      space,
      {
        context,
        sourceSignalId: SOURCE_ID,
        targetProfileId: TARGET_ID,
      }
    );
    expect(Reflect.get(space, "readSignalById")).toHaveBeenCalledWith(
      SOURCE_ID
    );
    expect(authorized).toBe(true);
  });

  it.each([
    ["Center alone", CENTER_ID, centerContext()],
    ["another requester", CENTER_ID, requesterContext("user-2", "human-2")],
    ["another source", "agt_other", requesterContext()],
  ])("rejects %s", async (_scenario, sourceProfileId, context) => {
    const { space } = createSpace(sourceProfileId);
    await expect(
      Reflect.get(space, "isWakeStopAuthorized").call(space, {
        context,
        sourceSignalId: SOURCE_ID,
        targetProfileId: TARGET_ID,
      })
    ).resolves.toBe(false);
  });

  it.each([
    "unattributed",
    "missing",
  ] as const)("rejects %s Wake provenance", async (provenance) => {
    const { space } = createSpace(CENTER_ID, provenance);
    await expect(
      Reflect.get(space, "isWakeStopAuthorized").call(space, {
        context: requesterContext(),
        sourceSignalId: SOURCE_ID,
        targetProfileId: TARGET_ID,
      })
    ).resolves.toBe(false);
  });

  it("keeps the represented target owner's Web Stop permission", async () => {
    const { space } = createSpace(CENTER_ID, "missing");
    const bindings = Reflect.get(space, "bindings");
    Reflect.set(space, "bindings", {
      ...bindings,
      OPENMELD_AUTH_WORKER: {
        resolveProfileById: vi.fn(async ({ openMeldProfileId }) => ({
          ok: true,
          profile: {
            ownerUserId: openMeldProfileId === TARGET_ID ? "user-owner" : null,
            status: "active",
          },
        })),
      },
    });
    await expect(
      Reflect.get(space, "isWakeStopAuthorized").call(space, {
        context: requesterContext("user-owner", "human-owner"),
        sourceSignalId: SOURCE_ID,
        targetProfileId: TARGET_ID,
      })
    ).resolves.toBe(true);
  });

  it.each([
    { label: "current DM", allowed: true },
    {
      label: "DM converted after the request",
      convertedAt: 200,
      allowed: true,
    },
    {
      label: "request authored after conversion",
      convertedAt: 50,
      allowed: false,
    },
    { label: "another author", sourceProfileId: "agt_other", allowed: false },
    {
      label: "reserved represented Wake",
      clientMessageId: "ca-wake:message-1",
      allowed: false,
    },
    { label: "ordinary Space", purpose: "ordinary", allowed: false },
    { label: "another pair", pairKey: "agt_other:agt_target", allowed: false },
    { label: "another organization", organizationId: "org-2", allowed: false },
    {
      label: "replaced Center",
      designatedProfileId: "agt_other",
      allowed: false,
    },
    { label: "paused Center", operatingState: "paused", allowed: false },
  ])("checks self-Stop for $label", async (scenario) => {
    const { space } = createSpace(scenario.sourceProfileId ?? CENTER_ID);
    Reflect.set(space, "readSignalById", () => ({
      type: "signal.text",
      ts: 100,
      data: {
        meta: { clientMessageId: scenario.clientMessageId ?? DM_CLIENT_ID },
      },
      profile: {
        kind: "agent",
        profileId: scenario.sourceProfileId ?? CENTER_ID,
      },
    }));
    Reflect.set(space, "readSpaceMetaRecord", () => ({
      purpose: scenario.purpose ?? "openmeld_dm_space",
      organizationId: scenario.organizationId ?? "org-1",
      directMessage: {
        pairKey: scenario.pairKey ?? [CENTER_ID, TARGET_ID].sort().join(":"),
        ...(scenario.convertedAt
          ? { convertedAt: new Date(scenario.convertedAt).toISOString() }
          : {}),
      },
    }));
    // D1 row shape from center_agent_designations; Space still owns the author check.
    Reflect.set(space, "bindings", {
      OPENMELD_DB: {
        prepare: () => ({
          bind: () => ({
            first: async () => ({
              organization_id: "org-1",
              agent_profile_id: scenario.designatedProfileId ?? CENTER_ID,
              operating_state: scenario.operatingState ?? "active",
              duty: null,
              designated_by: null,
              paused_at: null,
              paused_by_user_id: null,
              created_at: 0,
            }),
          }),
        }),
      },
    });
    await expect(
      Reflect.get(space, "isWakeStopAuthorized").call(space, {
        context: centerContext(),
        sourceSignalId: SOURCE_ID,
        targetProfileId: TARGET_ID,
      })
    ).resolves.toBe(scenario.allowed);
  });
});

describe("viewer-scoped Wake Stop eligibility", () => {
  const eligible = {
    controlMode: "cancel" as const,
    reasonCode: null,
    reliability: "native_cancel" as const,
    status: "eligible" as const,
  };
  const project = async (sourceProfileId: string, context: unknown) => {
    const { space } = createSpace(sourceProfileId);
    Reflect.set(
      space,
      "authorizeWritableSpaceAccess",
      vi.fn(async () => ({ ok: true }))
    );
    return await Reflect.get(space, "projectWakeStopEligibilityForViewer").call(
      space,
      {
        items: [
          {
            sourceSignalId: SOURCE_ID,
            targetProfileId: TARGET_ID,
            wakeStopEligibility: eligible,
          },
        ],
      },
      {
        spaceId: "space-1",
        actor: { kind: "authenticated", requestContext: context },
        proof: { kind: "none" },
      }
    );
  };

  it("hides Stop from the Center Agent without a requester", async () => {
    const response = await project(CENTER_ID, centerContext());
    expect(response.items[0].wakeStopEligibility).toBeNull();
  });

  it("hides Stop for someone else's Wake", async () => {
    const response = await project("agt_other", centerContext());
    expect(response.items[0].wakeStopEligibility).toBeNull();
  });

  it("shows Stop to the verified source-message requester", async () => {
    const response = await project(CENTER_ID, requesterContext());
    expect(response.items[0].wakeStopEligibility).toEqual(eligible);
  });
});

describe("Center Agent Stop uses the Space Stop path", () => {
  it.each([
    ["pre-agent", "cancelled", "openmeld_owned_pre_agent"],
    ["running", "cancellation_requested", "controller_control"],
  ] as const)("requests Stop for its %s Wake", async (phase, status, stopMode) => {
    const { space } = createSpace(CENTER_ID);
    const response = {
      cancellationState: {
        observedAtMs: 100,
        reasonCode: "runtime_coordinator.wake_stop_requested",
        status: status === "cancelled" ? "cancelled" : "requested",
      },
      ok: true,
      runtimeCoordinatorExecutionId: status === "cancelled" ? null : "rce-1",
      status,
      stopMode,
      targetProfileId: TARGET_ID,
    };
    const requestPreAgentWakeStop = vi.fn(async () => response);
    Reflect.set(
      space,
      "readWakeStopDispatchLookup",
      vi.fn(async () => ({
        matches: [
          {
            dispatchId: "dispatch-1",
            sourceSignalId: SOURCE_ID,
            targetProfileId: TARGET_ID,
          },
        ],
      }))
    );
    const requestRemoteAgentNativeDeliveryStop = vi.fn(async () =>
      phase === "running" ? response : null
    );
    Reflect.set(
      space,
      "requestRemoteAgentNativeDeliveryStop",
      requestRemoteAgentNativeDeliveryStop
    );
    Reflect.set(space, "requestPreAgentWakeStop", requestPreAgentWakeStop);
    const context = requesterContext();
    const body = {
      target: {
        by: "source_signal",
        sourceSignalId: SOURCE_ID,
        targetProfileId: TARGET_ID,
      },
    };
    await expect(
      Reflect.get(space, "handlePostWakeStop").call(space, body, context)
    ).resolves.toEqual(response);
    expect(requestRemoteAgentNativeDeliveryStop).toHaveBeenCalledOnce();
    expect(requestPreAgentWakeStop).toHaveBeenCalledTimes(
      phase === "pre-agent" ? 1 : 0
    );
  });
});
