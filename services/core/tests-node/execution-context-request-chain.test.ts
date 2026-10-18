import { afterEach, describe, expect, it, vi } from "vitest";

const feature = vi.hoisted(() => ({ enforced: false }));
vi.mock("../src/member-agent/member-agents-feature", () => ({
  isMemberAgentsEnabled: () => feature.enforced,
  isRequestChainEnforced: () => feature.enforced,
}));

const { assertContextRequestChain } = await import(
  "../src/runtime-transport/application/execution-context-authority"
);

afterEach(() => {
  feature.enforced = false;
});

// Invariant 4 (design-plans/member-agent-program.md §9).
describe("accepted Execution Context request chain", () => {
  it("treats a context without a chain as owner-rooted legacy before enforcement", () => {
    expect(() => assertContextRequestChain({})).not.toThrow();
  });

  it("requires a human-rooted chain for every context accepted after enforcement", () => {
    feature.enforced = true;
    expect(() => assertContextRequestChain({})).toThrow(
      "execution_context.request_chain_required"
    );
    expect(() =>
      assertContextRequestChain({
        requestChain: [
          { kind: "human", profileId: "human-tali" },
          { kind: "agent", profileId: "agent-a" },
        ],
      })
    ).not.toThrow();
  });
});
