import { describe, expect, it } from "vitest";
import {
  buildProfileDetailsSnapshotFromAuthProfile,
  buildProfileDetailsSnapshotFromHumanProfile,
  buildProfileDetailsSnapshotFromSpaceMember,
} from "../src/profile-details";

describe("Profile Details snapshot", () => {
  it("builds Human Profile details without inventing account or Organization facts", () => {
    const snapshot = buildProfileDetailsSnapshotFromHumanProfile({
      profileId: "human-grace",
      profileName: "Grace Hopper",
      viewerScope: "observer",
    });

    expect(snapshot).toMatchObject({
      context: "account",
      profileId: "human-grace",
      profileKind: "human",
      profileName: "Grace Hopper",
      viewerScope: "observer",
    });
    expect(listSectionTitles(snapshot)).toEqual(["Advanced details"]);
    expect(findRowValue(snapshot, "profile", "Profile type")).toBeNull();
    expect(findRowValue(snapshot, "profile", "Handle")).toBeNull();
    expect(findRowValue(snapshot, "profile", "Status")).toBeNull();
    expect(findRowValue(snapshot, "advanced", "Profile ID")).toBe(
      "human-grace"
    );
  });

  it("keeps account Profile Details scoped to owner-self facts", () => {
    const snapshot = buildProfileDetailsSnapshotFromAuthProfile({
      agentControllerPermissionModeDetail: "Read-only",
      modelDetail: "Codex · gpt-5.5 · model default",
      primaryBinding: {
        authoritySource: "binding_truth",
        bindingState: "enabled_primary",
        dispatchEligibility: {
          reasonCodes: [],
          routable: true,
          status: "routable",
        },
        executionTarget: {
          agentControllerConversationId: "019ed8d3-8c88-7a03-94ec-3aa275f195ce",
          agentControllerRef: "builtin:codex",
          openMeldServiceRuntimeId: {
            source: "runtime_registry_authority",
            value: "runtime_bb834e80a4fd4285beaaed800b19d23e",
          },
        },
        grantsClaimSuccess: false,
        agentProfileId: "agt_7600b644-500a-4955-b807-ece84ecc68187",
        reasonCodes: [],
        resolutionSource: "binding_truth",
        routable: true,
      },
      profile: {
        openMeldProfileId: "agt_7600b644-500a-4955-b807-ece84ecc68187",
        createdAt: "2026-06-18T00:00:00.000Z",
        createdByUserId: "user-1",
        creationActorProfileId: "agt_11111111-1111-4111-8111-111111111111",
        creatorProfileId: "human-1",
        isDefault: false,
        lastUsedAt: null,
        managedRole: null,
        ownerName: "Felix",
        ownerUserId: "user-1",
        profileHandle: "codex-setup-interviewer-20260618",
        profileKind: "agent",
        profileName: "Codex Setup Interviewer 20260618",
        source: "center_agent_create",
        status: "active",
        updatedAt: "2026-06-19T00:00:00.000Z",
      },
      readiness: null,
      viewerScope: "owner_self",
    });

    expect(snapshot.viewerScope).toBe("owner_self");
    expect(snapshot.context).toBe("account");
    expect(listSectionTitles(snapshot)).toEqual([
      "Profile",
      "Connection",
      "Agent Controller Permission Mode",
      "Advanced details",
    ]);
    expect(findRowValue(snapshot, "profile", "Owner")).toBe("Felix");
    expect(findRowValue(snapshot, "profile", "Created by")).toBe(
      "Center Agent"
    );
    expect(findRowValue(snapshot, "profile", "Created from")).toBe(
      "Center Agent"
    );
    expect(findRowValue(snapshot, "profile", "Created")).toBe("Jun 18, 2026");
    expect(findRowValue(snapshot, "profile", "Updated")).toBe("Jun 19, 2026");
    expect(findRowValue(snapshot, "connection", "Agent controller")).toBe(
      "builtin:codex"
    );
    expect(
      findRowValue(snapshot, "connection", "Controller conversation ID")
    ).toBe("019ed8d3-8c88-7a03-94ec-3aa275f195ce");
    expect(
      findRowValue(snapshot, "advanced", "Controller conversation ID")
    ).toBeNull();
    expect(
      findRowValue(snapshot, "advanced", "OpenMeld Service runtime ID")
    ).toBeNull();
    expect(
      findRow(snapshot, "connection", "Controller conversation ID")
    ).toMatchObject({
      source: "binding",
      valueKind: "identifier",
    });
    expect(findRowValue(snapshot, "advanced", "Binding source")).toBe(
      "Binding Truth"
    );
    expect(findRowValue(snapshot, "advanced", "Created by profile ID")).toBe(
      "agt_11111111-1111-4111-8111-111111111111"
    );
    expect(
      findRowValue(
        snapshot,
        "agent_controller_permission_mode",
        "Permissions mode"
      )
    ).toBe("Read-only");
  });

  it("shows the same Agent Profile work summary while keeping work locations owner-only", () => {
    const input = {
      agentControllerPermissionModeDetail: null,
      modelDetail: null,
      operationalContext: {
        currentWorkLocation: "Launch planning",
        queuedWorkLocations: ["Customer follow-up", "Release review"],
        recoveryAction: null,
        status: "working" as const,
        waitingCount: 2,
      },
      primaryBinding: null,
      profile: {
        openMeldProfileId: "agt_7600b644-500a-4955-b807-ece84ecc68187",
        createdAt: "2026-06-18T00:00:00.000Z",
        createdByUserId: "user-1",
        creatorProfileId: "human-1",
        isDefault: false,
        lastUsedAt: null,
        managedRole: null,
        ownerName: "Felix",
        ownerUserId: "user-1",
        profileHandle: "research-agent",
        profileKind: "agent" as const,
        profileName: "Research Agent",
        source: "web_create",
        status: "active" as const,
        updatedAt: "2026-06-19T00:00:00.000Z",
      },
      readiness: null,
    };
    const owner = buildProfileDetailsSnapshotFromAuthProfile({
      ...input,
      viewerScope: "owner_self",
    });
    const observer = buildProfileDetailsSnapshotFromAuthProfile({
      ...input,
      viewerScope: "observer",
    });

    expect(findRowValue(owner, "activity", "Work")).toBe("Working · 2 queued");
    expect(findRowValue(observer, "activity", "Work")).toBe(
      "Working · 2 queued"
    );
    expect(findRowValue(owner, "activity", "Working in")).toBe(
      "Launch planning"
    );
    expect(findRowValue(owner, "activity", "Queued 1")).toBe(
      "Customer follow-up"
    );
    expect(findRowValue(observer, "activity", "Working in")).toBeNull();
    expect(findRowValue(observer, "activity", "Queued 1")).toBeNull();

    const pausedInput = {
      ...input,
      operationalContext: {
        ...input.operationalContext,
        status: "paused" as const,
      },
    };
    const pausedOwner = buildProfileDetailsSnapshotFromAuthProfile({
      ...pausedInput,
      viewerScope: "owner_self",
    });
    const pausedObserver = buildProfileDetailsSnapshotFromAuthProfile({
      ...pausedInput,
      viewerScope: "observer",
    });

    expect(findRowValue(pausedOwner, "activity", "Work")).toBe(
      "Paused · 2 queued"
    );
    expect(findRowValue(pausedObserver, "activity", "Work")).toBe(
      "Paused · 2 queued"
    );
    expect(findRowValue(pausedOwner, "activity", "Paused in")).toBe(
      "Launch planning"
    );
    expect(findRowValue(pausedOwner, "activity", "Queued 1")).toBe(
      "Customer follow-up"
    );
    expect(findRowValue(pausedObserver, "activity", "Paused in")).toBeNull();
    expect(findRowValue(pausedObserver, "activity", "Queued 1")).toBeNull();

    const pausedWithoutQueue = buildProfileDetailsSnapshotFromAuthProfile({
      ...pausedInput,
      operationalContext: {
        ...pausedInput.operationalContext,
        queuedWorkLocations: [],
        waitingCount: 0,
      },
      viewerScope: "observer",
    });
    expect(findRowValue(pausedWithoutQueue, "activity", "Work")).toBe("Paused");
  });

  it("adds an owner-only recovery action without changing the compact workload copy", () => {
    const input = {
      agentControllerPermissionModeDetail: null,
      modelDetail: null,
      operationalContext: {
        currentWorkLocation: "Launch planning",
        queuedWorkLocations: ["Customer follow-up"],
        recoveryAction: {
          kind: "continue_interrupted_work" as const,
        },
        status: "paused" as const,
        waitingCount: 1,
      },
      primaryBinding: null,
      profile: {
        openMeldProfileId: "agt_7600b644-500a-4955-b807-ece84ecc68187",
        createdAt: "2026-06-18T00:00:00.000Z",
        createdByUserId: "user-1",
        creatorProfileId: "human-1",
        isDefault: false,
        lastUsedAt: null,
        managedRole: null,
        ownerName: "Felix",
        ownerUserId: "user-1",
        profileHandle: "research-agent",
        profileKind: "agent" as const,
        profileName: "Research Agent",
        source: "web_create",
        status: "active" as const,
        updatedAt: "2026-06-19T00:00:00.000Z",
      },
      readiness: null,
    };
    const owner = buildProfileDetailsSnapshotFromAuthProfile({
      ...input,
      viewerScope: "owner_self",
    });
    const observer = buildProfileDetailsSnapshotFromAuthProfile({
      ...input,
      viewerScope: "observer",
    });

    expect(findRowValue(owner, "activity", "Work")).toBe("Paused · 1 queued");
    expect(findRowValue(observer, "activity", "Work")).toBe(
      "Paused · 1 queued"
    );
    expect(
      owner.sections.find((section) => section.id === "activity")
    ).toMatchObject({
      recoveryAction: {
        kind: "continue_interrupted_work",
        visibility: "owner_self",
      },
    });
    expect(
      observer.sections.find((section) => section.id === "activity")
    ).toMatchObject({ recoveryAction: null });
  });

  it("keeps owner Space Profile Details rich without moving Space context into profile identity", () => {
    const snapshot = buildProfileDetailsSnapshotFromSpaceMember({
      agentControllerPermissionModeDetail: "Approve for me",
      entry: buildSpaceMemberInput(),
      modelDetail: "Codex · gpt-5.5 · model default",
      viewerScope: "owner_self",
    });

    expect(snapshot.viewerScope).toBe("owner_self");
    expect(snapshot.context).toBe("space");
    expect(listSectionTitles(snapshot)).toEqual([
      "Profile",
      "Space membership",
      "Connection",
      "Agent Controller Permission Mode",
      "Wake availability",
      "Advanced details",
    ]);
    expect(findRowValue(snapshot, "space_membership", "Mention as")).toBe(
      "@codex(wake)"
    );
    expect(findRowValue(snapshot, "connection", "Computer")).toBe(
      "Felix's MacBook Pro"
    );
    expect(
      findRowValue(snapshot, "connection", "Controller conversation ID")
    ).toBe("thread-codex-1");
    expect(
      findRow(snapshot, "connection", "Controller conversation ID")
    ).toMatchObject({
      source: "local_runtime",
      valueKind: "identifier",
    });
    expect(
      findRowValue(snapshot, "advanced", "Controller conversation ID")
    ).toBeNull();
    expect(findRowValue(snapshot, "advanced", "Workspace directory")).toBe(
      "/Users/felix/project"
    );
    expect(findRow(snapshot, "advanced", "Workspace directory")).toMatchObject({
      source: "local_runtime",
      valueKind: "path",
    });
    expect(findRowValue(snapshot, "advanced", "Wake reason code")).toBe(
      "agent_execution.ready"
    );
    expect(
      findRowValue(
        snapshot,
        "agent_controller_permission_mode",
        "Permissions mode"
      )
    ).toBe("Approve for me");
    expect(findRow(snapshot, "advanced", "Wake reason code")).toMatchObject({
      source: "readiness",
      valueKind: "identifier",
    });
  });

  it("removes owner-only local connection facts for observer Space Profile Details", () => {
    const snapshot = buildProfileDetailsSnapshotFromSpaceMember({
      agentControllerPermissionModeDetail: "Approve for me",
      entry: buildSpaceMemberInput(),
      modelDetail: "Codex · gpt-5.5 · model default",
      viewerScope: "observer",
    });

    expect(snapshot.viewerScope).toBe("observer");
    expect(listSectionTitles(snapshot)).toEqual([
      "Profile",
      "Space membership",
      "Agent Controller Permission Mode",
      "Wake availability",
      "Advanced details",
    ]);
    expect(
      snapshot.sections.some((section) => section.id === "connection")
    ).toBe(false);
    expect(findRowValue(snapshot, "advanced", "Profile ID")).toBe("agt-1");
    expect(collectFieldSources(snapshot)).not.toEqual(
      expect.arrayContaining(["agent_controller", "local_runtime"])
    );
    expect(
      findRowValue(
        snapshot,
        "agent_controller_permission_mode",
        "Permissions mode"
      )
    ).toBe("Approve for me");
    expect(collectFieldVisibilities(snapshot)).not.toContain("owner_self");
    expect(
      findRowValue(snapshot, "advanced", "Workspace directory")
    ).toBeNull();
    expect(
      findRowValue(snapshot, "advanced", "Controller conversation ID")
    ).toBeNull();
    expect(findRowValue(snapshot, "advanced", "Wake reason code")).toBeNull();
  });
});

function buildSpaceMemberInput() {
  return {
    addedByDisplayName: "Felix",
    addedByProfileId: "human-1",
    agentControllerConversationId: "thread-codex-1",
    agentControllerRef: "builtin:codex",
    availabilityPhase: "available",
    availabilityReasonCode: "agent_execution.ready",
    availabilitySummary: "Codex can reply from this computer.",
    availabilityTooltip: "Available for Wake",
    lastSeenLabel: "Seen 1d ago",
    mentionLabel: "@codex(wake)",
    ownerDisplay: "Felix",
    ownerUserId: "user-1",
    profileId: "agt-1",
    profileKind: "agent" as const,
    profileName: "Codex",
    runtimeDeviceDisplayName: "Felix's MacBook Pro",
    workingDirectory: "/Users/felix/project",
  };
}

function listSectionTitles(snapshot: {
  sections: readonly { title: string }[];
}): string[] {
  return snapshot.sections.map((section) => section.title);
}

function findRowValue(
  snapshot: {
    sections: readonly {
      id: string;
      rows: readonly { label: string; value: string }[];
    }[];
  },
  sectionId: string,
  label: string
): string | null {
  const section = snapshot.sections.find((item) => item.id === sectionId);
  return section?.rows.find((row) => row.label === label)?.value ?? null;
}

function findRow(
  snapshot: {
    sections: readonly {
      id: string;
      rows: readonly {
        label: string;
        source: string;
        value: string;
        valueKind: string;
      }[];
    }[];
  },
  sectionId: string,
  label: string
) {
  const section = snapshot.sections.find((item) => item.id === sectionId);
  return section?.rows.find((row) => row.label === label) ?? null;
}

function collectFieldSources(snapshot: {
  sections: readonly { rows: readonly { source: string }[] }[];
}): string[] {
  return snapshot.sections.flatMap((section) =>
    section.rows.map((row) => row.source)
  );
}

function collectFieldVisibilities(snapshot: {
  sections: readonly { rows: readonly { visibility: string }[] }[];
}): string[] {
  return snapshot.sections.flatMap((section) =>
    section.rows.map((row) => row.visibility)
  );
}
