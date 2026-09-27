import { describe, expect, it, vi } from "vitest";
import { Space } from "../src/space/transport/do/space";

const CENTER_ID = "agt_center";
const SOURCE_ID = "sig-source";
const TARGET_ID = "agt_target";

function createSpace(sourceProfileId: string, designated = true) {
  const space = Object.create(Space.prototype) as Space;
  Reflect.set(space, "bindings", {});
  const verifyDesignation = vi.fn(async () => designated);
  Reflect.set(space, "isCurrentDesignatedCenterAgentCaller", verifyDesignation);
  Reflect.set(
    space,
    "readSignalById",
    vi.fn(() => ({
      profile: { kind: "agent", profileId: sourceProfileId },
    }))
  );
  return {
    space,
    verifyDesignation,
  };
}

function centerContext(profileId = CENTER_ID) {
  return {
    activeOrganizationId: "org-1",
    actorContext: {
      callerPrincipalId: profileId,
      openMeldProfileId: profileId,
      profileKind: "agent",
      profileName: "Center Agent",
      requestId: "request-1",
    },
  };
}

describe("Center Agent Wake Stop authorization", () => {
  it("lets the current designated Center Agent stop its own source Wake", async () => {
    const context = centerContext();
    const { space, verifyDesignation } = createSpace(CENTER_ID);
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
    expect(verifyDesignation).toHaveBeenCalledWith(context);
    expect(authorized).toBe(true);
  });

  it.each([
    ["another source", "agt_other", centerContext()],
    ["former designation", CENTER_ID, centerContext()],
    ["another organization", CENTER_ID, centerContext()],
  ])("rejects %s", async (scenario, sourceProfileId, context) => {
    const { space, verifyDesignation } = createSpace(
      sourceProfileId,
      scenario === "another source"
    );
    await expect(
      Reflect.get(space, "isWakeStopAuthorized").call(space, {
        context,
        sourceSignalId: SOURCE_ID,
        targetProfileId: TARGET_ID,
      })
    ).resolves.toBe(false);
    expect(verifyDesignation).toHaveBeenCalledTimes(
      scenario === "another source" ? 0 : 1
    );
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

  it("shows Stop to the Center Agent for its own Wake", async () => {
    const response = await project(CENTER_ID, centerContext());
    expect(response.items[0].wakeStopEligibility).toEqual(eligible);
  });

  it("hides Stop for someone else's Wake", async () => {
    const response = await project("agt_other", centerContext());
    expect(response.items[0].wakeStopEligibility).toBeNull();
  });

  it("shows Stop to the verified source-message requester", async () => {
    const context = {
      activeOrganizationId: "org-1",
      actorContext: {
        callerPrincipalId: "user-1",
        ownerUserId: "user-1",
        openMeldProfileId: "human-1",
        profileKind: "human",
        profileName: "Mira",
        requestId: "request-1",
      },
    };
    const response = await project("human-1", context);
    expect(response.items[0].wakeStopEligibility).toEqual(eligible);
  });
});

describe("Center Agent Stop uses the Space Stop path", () => {
  it.each([
    ["pre-agent", "cancelled", "openmeld_owned_pre_agent"],
    ["running", "cancellation_requested", "controller_control"],
  ] as const)("requests Stop for its %s Wake", async (_phase, status, stopMode) => {
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
    Reflect.set(
      space,
      "requestRemoteAgentNativeDeliveryStop",
      vi.fn(async () => null)
    );
    Reflect.set(space, "requestPreAgentWakeStop", requestPreAgentWakeStop);
    const context = centerContext();
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
    expect(requestPreAgentWakeStop).toHaveBeenCalledOnce();
  });
});
