import { describe, expect, it } from "vitest";
import { projectOrganizationDirectoryAgentProfileOperationalContext } from "../agent-profile/application/agent-profile-operational-context";

const workingContext = {
  currentWorkReference: {
    sourceSignalId: "sig-current",
    spaceId: "space-current",
  },
  queuedWorkReferences: [
    { sourceSignalId: "sig-queued", spaceId: "space-queued" },
  ],
  status: "working" as const,
  waitingCount: 1,
};

const pausedContext = {
  ...workingContext,
  recoveryAction: "continue_interrupted_work" as const,
  status: "paused" as const,
};

describe("Agent Profile Operational Context directory projection", () => {
  it("gives teammates the truthful workload summary without private work locations", () => {
    expect(
      projectOrganizationDirectoryAgentProfileOperationalContext({
        exposeWorkReferences: false,
        operationalContext: workingContext,
        spaceNamesById: new Map([
          ["space-current", "Launch planning"],
          ["space-queued", "Customer follow-up"],
        ]),
      })
    ).toEqual({ status: "working", waitingCount: 1 });
  });

  it("gives the owner the same summary plus the current and queued locations", () => {
    expect(
      projectOrganizationDirectoryAgentProfileOperationalContext({
        exposeWorkReferences: true,
        operationalContext: workingContext,
        spaceNamesById: new Map([
          ["space-current", "Launch planning"],
          ["space-queued", "Customer follow-up"],
        ]),
      })
    ).toEqual({
      currentWorkLocation: {
        spaceId: "space-current",
        spaceName: "Launch planning",
      },
      queuedWorkLocations: [
        { spaceId: "space-queued", spaceName: "Customer follow-up" },
      ],
      status: "working",
      waitingCount: 1,
    });
  });

  it("keeps paused copy identical while only the owner receives locations", () => {
    const spaceNamesById = new Map([
      ["space-current", "Launch planning"],
      ["space-queued", "Customer follow-up"],
    ]);

    expect(
      projectOrganizationDirectoryAgentProfileOperationalContext({
        exposeWorkReferences: false,
        operationalContext: pausedContext,
        spaceNamesById,
      })
    ).toEqual({ status: "paused", waitingCount: 1 });
    expect(
      projectOrganizationDirectoryAgentProfileOperationalContext({
        exposeWorkReferences: true,
        operationalContext: pausedContext,
        spaceNamesById,
      })
    ).toEqual({
      currentWorkLocation: {
        spaceId: "space-current",
        spaceName: "Launch planning",
      },
      queuedWorkLocations: [
        { spaceId: "space-queued", spaceName: "Customer follow-up" },
      ],
      recoveryAction: "continue_interrupted_work",
      status: "paused",
      waitingCount: 1,
    });
  });
});
