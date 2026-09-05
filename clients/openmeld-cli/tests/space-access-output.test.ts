import type { GetSpaceEntryResolutionResponse } from "@openmeld/schemas/types";
import { describe, expect, it, vi } from "vitest";
import type { Presenter } from "../src/runtime/presenter";
import {
  emitSpaceAccessAgentOutput,
  emitSpaceAccessHumanOutput,
} from "../src/space/access-output";

const target = {
  spaceId: "space-1",
  signalId: "signal-1",
  threadRootSignalId: "thread-1",
};

function createPresenter(view: "human" | "agent") {
  return {
    presenter: {
      view,
      event: vi.fn(),
      line: vi.fn(),
      data: vi.fn(),
    } satisfies Presenter,
  };
}

describe("Space access CLI output", () => {
  it("gives agents the canonical resolution and a target continuation", () => {
    const { presenter } = createPresenter("agent");
    const resolution: GetSpaceEntryResolutionResponse = {
      target,
      view: { state: "allowed", experience: "member" },
      participation: { state: "active_member" },
      safeContext: {
        organizationId: "org-1",
        organizationSlug: "acme",
        spaceName: "Launch Room",
      },
      recovery: null,
    };

    emitSpaceAccessAgentOutput({ presenter, resolution });

    expect(presenter.data).toHaveBeenCalledWith({
      code: "space.access.resolved",
      payload: {
        resolution,
        viewAction: { kind: "continue_to_target", target },
      },
    });
  });

  it("gives agents an owner-shaped recovery without inventing a request flow", () => {
    const { presenter } = createPresenter("agent");
    const owner = {
      profileId: "hum_11111111-1111-4111-8111-111111111111",
      displayName: "Avery Chen",
    };
    const resolution: GetSpaceEntryResolutionResponse = {
      target,
      view: { state: "membership_required" },
      participation: { state: "owner_add_required" },
      safeContext: {
        organizationId: "org-1",
        organizationSlug: "acme",
        spaceName: "Launch Room",
        owner,
      },
      recovery: { kind: "contact_space_owner" },
    };

    emitSpaceAccessAgentOutput({ presenter, resolution });

    expect(presenter.data).toHaveBeenCalledWith({
      code: "space.access.resolved",
      payload: {
        resolution,
        viewAction: { kind: "contact_space_owner", owner },
      },
    });
  });

  it("renders one clear cause and next action for a blocked person", () => {
    const { presenter } = createPresenter("human");
    emitSpaceAccessHumanOutput({
      presenter,
      resolution: {
        target,
        view: { state: "membership_required" },
        participation: { state: "owner_add_required" },
        safeContext: {
          organizationId: "org-1",
          organizationSlug: "acme",
          spaceName: "Launch Room",
          owner: {
            profileId: "hum_11111111-1111-4111-8111-111111111111",
            displayName: "Avery Chen",
          },
        },
        recovery: { kind: "contact_space_owner" },
      },
    });

    expect(presenter.line).toHaveBeenNthCalledWith(1, {
      code: "space.access.membership_required",
      text: "You don't have access to Launch Room.",
    });
    expect(presenter.line).toHaveBeenNthCalledWith(2, {
      code: "space.access.next",
      text: "Ask Avery Chen to add you to this Space.",
    });
  });

  it("does not treat a public read as blocked by its participation requirement", () => {
    const { presenter } = createPresenter("human");
    emitSpaceAccessHumanOutput({
      presenter,
      resolution: {
        target,
        view: { state: "allowed", experience: "public" },
        participation: { state: "password_required" },
        safeContext: { spaceName: "Launch Room" },
        recovery: { kind: "provide_password" },
      },
    });

    expect(presenter.line).toHaveBeenCalledTimes(1);
    expect(presenter.line).toHaveBeenCalledWith({
      code: "space.access.allowed",
      text: "Launch Room is available to read publicly.",
    });
  });

  it("keeps unavailable Space details private", () => {
    const { presenter } = createPresenter("human");
    emitSpaceAccessHumanOutput({
      presenter,
      resolution: {
        target,
        view: { state: "unavailable" },
        participation: { state: "unavailable" },
        safeContext: {},
        recovery: null,
      },
    });

    expect(presenter.line).toHaveBeenCalledWith({
      code: "space.access.unavailable",
      text: "This Space isn't available to this account.",
    });
  });
});
