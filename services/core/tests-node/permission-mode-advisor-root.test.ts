import { afterEach, describe, expect, it, vi } from "vitest";

const feature = vi.hoisted(() => ({ enforced: false }));
vi.mock("../src/member-agent/member-agents-feature", () => ({
  isMemberAgentsEnabled: () => feature.enforced,
  isRequestChainEnforced: () => feature.enforced,
}));

const { resolvePermissionAdvisorRequesterProfileId } = await import(
  "../src/agent-profile/application/permission-mode-advisor"
);

afterEach(() => {
  feature.enforced = false;
});

// Tali → Felix's Agent A → Felix's Agent B: the one-hop author of B's Wake is
// Felix's own Agent, but the root requester is Tali.
const relayedFromTali = {
  oneHopRequesterProfileId: "agent-a",
  rootRequesterProfileId: "human-tali",
};

describe("permission-mode advisor requester", () => {
  it("counts by the one-hop requester before the chain is enforced", () => {
    expect(resolvePermissionAdvisorRequesterProfileId(relayedFromTali)).toBe(
      "agent-a"
    );
  });

  it("counts by the root requester once the chain is enforced", () => {
    feature.enforced = true;
    expect(resolvePermissionAdvisorRequesterProfileId(relayedFromTali)).toBe(
      "human-tali"
    );
    // A Wake admitted before Core recorded chains keeps its one-hop basis.
    expect(
      resolvePermissionAdvisorRequesterProfileId({
        oneHopRequesterProfileId: "human-tali",
        rootRequesterProfileId: null,
      })
    ).toBe("human-tali");
  });
});
