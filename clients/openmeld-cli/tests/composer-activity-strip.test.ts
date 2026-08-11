import { stripVTControlCharacters } from "node:util";
import {
  createSpaceMemberAgentSnapshot,
  createSpaceMembersSnapshot,
} from "@openmeld/schemas/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ComposerActivityStrip } from "../src/space/shell/pi-tui/components/composer-activity-strip";
import type {
  ComposerActivityRowViewState,
  ComposerActivityViewState,
  DispatchActivityActorViewState,
} from "../src/space/view/space-session-view-state";

const STREAMING_PREVIEW_LINE_REGEX =
  /⠋ · 4s · oh-my-claude is streaming · Working on your request right now\./u;
const HI_AGENT_PROFILE_ID = "agt_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORIGINAL_AGENT_PROFILE_ID = "agt_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ALIAS_AGENT_PROFILE_ID = "agt_cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const OWNER_PROFILE_ID = "11111111-1111-4111-8111-111111111111";

function createActivityAgentSnapshot(input: {
  agentControllerRef?: string;
  mentionAlias?: string | null;
  profileId: string;
  profileName: string;
}) {
  return createSpaceMemberAgentSnapshot({
    addedAt: "2026-03-14T12:00:00.000Z",
    addedByDisplayName: "OpenMeld Dev Local Test",
    addedByOwnerUserId: "owner-1",
    addedByProfileId: OWNER_PROFILE_ID,
    agentControllerRef: input.agentControllerRef ?? "builtin:codex",
    createdAt: "2026-03-14T12:00:00.000Z",
    firstEnteredAt: null,
    lastEnteredAt: null,
    lastSeenAt: "2026-03-14T12:00:00.000Z",
    lastSeenLabel: "Seen now",
    liveNow: true,
    memberSourceLabel: "Added by OpenMeld Dev Local Test",
    mentionAlias: input.mentionAlias ?? null,
    ownerName: "OpenMeld Dev Local Test",
    ownerUserId: "owner-1",
    profileId: input.profileId,
    profileName: input.profileName,
    updatedAt: "2026-03-14T12:00:00.000Z",
    wakeabilityReasonText: "Ready",
  });
}

function createActivitySpaceMembersSnapshot(
  agents: ReturnType<typeof createActivityAgentSnapshot>[]
) {
  return createSpaceMembersSnapshot({
    agents,
    generatedAt: "2026-03-14T12:00:00.000Z",
    humans: [],
    spaceId: "space-1",
  });
}

describe("ComposerActivityStrip", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders a single replying actor with elapsed time and inline preview", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-14T12:00:10.000Z"));

    const strip = new ComposerActivityStrip({
      requestRender: vi.fn(),
    } as never);

    strip.setActivity(
      createComposerActivity({
        elapsedSeconds: 4,
        leadActor: createActor({
          profileId: "agt_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          label: "oh-my-claude",
          startedAtMs: Date.now() - 4000,
          updatedAtMs: Date.now() - 1000,
          latestPreviewText: "Working on your request right now.",
          latestPreviewUpdatedAtMs: Date.now() - 1000,
        }),
        mode: "streaming",
        previewText: "Working on your request right now.",
      })
    );

    const rendered = strip
      .render(80)
      .map((line) => stripVTControlCharacters(line))
      .join("\n");

    expect(rendered).toContain("oh-my-claude is streaming");
    expect(rendered).toContain("streaming");
    expect(rendered).toContain("4s");
    expect(rendered).toContain("Working on your request right now.");
    expect(rendered).not.toContain("Preview:");
    expect(rendered).toMatch(STREAMING_PREVIEW_LINE_REGEX);

    strip.stop();
  });

  it("rotates replying mode labels every three seconds when preview is absent", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-14T12:00:00.000Z"));

    const strip = new ComposerActivityStrip({
      requestRender: vi.fn(),
    } as never);

    strip.setActivity(
      createComposerActivity({
        elapsedSeconds: 0,
        previewText: "",
      })
    );
    expect(stripVTControlCharacters(strip.render(80).join("\n"))).toContain(
      "oh-my-claude is replying"
    );

    strip.setActivity(
      createComposerActivity({
        elapsedSeconds: 3,
        previewText: "",
      })
    );
    expect(stripVTControlCharacters(strip.render(80).join("\n"))).toContain(
      "oh-my-claude is thinking"
    );

    strip.setActivity(
      createComposerActivity({
        elapsedSeconds: 6,
        previewText: "",
      })
    );
    expect(stripVTControlCharacters(strip.render(80).join("\n"))).toContain(
      "oh-my-claude is working"
    );

    strip.stop();
  });

  it("animates trailing dots while waiting for preview text", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-14T12:00:00.000Z"));

    const strip = new ComposerActivityStrip({
      requestRender: vi.fn(),
    } as never);

    strip.setActivity(
      createComposerActivity({
        elapsedSeconds: 0,
        previewText: "",
      })
    );

    const first = stripVTControlCharacters(strip.render(80).join("\n"));
    expect(first).toContain("oh-my-claude is replying.");

    vi.advanceTimersByTime(STRIP_TICK_STEP_MS);
    const second = stripVTControlCharacters(strip.render(80).join("\n"));
    expect(second).toContain("oh-my-claude is replying..");

    vi.advanceTimersByTime(STRIP_TICK_STEP_MS);
    const third = stripVTControlCharacters(strip.render(80).join("\n"));
    expect(third).toContain("oh-my-claude is replying...");

    vi.advanceTimersByTime(STRIP_TICK_STEP_MS);
    const fourth = stripVTControlCharacters(strip.render(80).join("\n"));
    expect(fourth).toContain("oh-my-claude is replying.");

    strip.stop();
  });

  it("renders multiple activity rows independently", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-14T12:00:20.000Z"));

    const strip = new ComposerActivityStrip({
      requestRender: vi.fn(),
    } as never);

    strip.setActivity(
      createComposerActivity({
        actors: [
          createActor({
            profileId: "agt_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            label: "hi-agent",
            startedAtMs: 10_000,
            updatedAtMs: 18_000,
            latestPreviewText: "",
            latestPreviewUpdatedAtMs: null,
          }),
          createActor({
            profileId: "agt_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            label: "oh-my-claude",
            startedAtMs: 12_000,
            updatedAtMs: 19_000,
            latestPreviewText: "Working",
            latestPreviewUpdatedAtMs: 19_000,
          }),
        ],
        leadActor: createActor({
          profileId: "agt_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          label: "oh-my-claude",
          startedAtMs: 12_000,
          updatedAtMs: 19_000,
          latestPreviewText: "Working",
          latestPreviewUpdatedAtMs: 19_000,
        }),
        mode: "streaming",
        previewText: "Working",
        rows: [
          createRow({
            key: "dispatch-hi",
            mode: "replying",
            elapsedSeconds: 8,
            leadActor: createActor({
              profileId: "agt_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
              label: "hi-agent",
              startedAtMs: 10_000,
              updatedAtMs: 18_000,
              latestPreviewText: "",
              latestPreviewUpdatedAtMs: null,
            }),
          }),
          createRow({
            key: "dispatch-claude",
            mode: "streaming",
            elapsedSeconds: 7,
            previewText: "Working",
            leadActor: createActor({
              profileId: "agt_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
              label: "oh-my-claude",
              startedAtMs: 12_000,
              updatedAtMs: 19_000,
              latestPreviewText: "Working",
              latestPreviewUpdatedAtMs: 19_000,
            }),
          }),
        ],
      })
    );

    const rendered = strip
      .render(120)
      .map((line) => stripVTControlCharacters(line))
      .join("\n");

    expect(rendered).toContain("hi-agent is working");
    expect(rendered).toContain("oh-my-claude is streaming");
    expect(rendered).not.toContain("+1 more active");

    strip.stop();
  });

  it("shows overflow when more than two activity rows are active", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-14T12:00:20.000Z"));

    const strip = new ComposerActivityStrip({
      requestRender: vi.fn(),
    } as never);

    strip.setActivity(
      createComposerActivity({
        mode: "replying",
        rows: [
          createRow({
            key: "dispatch-a",
            mode: "replying",
            elapsedSeconds: 12,
            leadActor: createActor({
              profileId: "agt_a",
              label: "alpha-agent",
              startedAtMs: 8000,
              updatedAtMs: 18_000,
              latestPreviewText: "",
              latestPreviewUpdatedAtMs: null,
            }),
          }),
          createRow({
            key: "dispatch-b",
            mode: "retrying",
            elapsedSeconds: 6,
            hint: "Retrying @beta-agent...",
            leadActor: createActor({
              profileId: "agt_b",
              label: "beta-agent",
              startedAtMs: 12_000,
              updatedAtMs: 19_000,
              latestPreviewText: "",
              latestPreviewUpdatedAtMs: null,
            }),
          }),
        ],
        overflowCount: 1,
      })
    );

    const rendered = stripVTControlCharacters(strip.render(80).join("\n"));
    expect(rendered).toContain("+1 more active");
    expect(rendered).toContain("alpha-agent is thinking");
    expect(rendered).toContain("Retrying @beta-agent...");

    strip.stop();
  });

  it("scrolls long preview text inline instead of permanently truncating it", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-14T12:00:30.000Z"));

    const requestRender = vi.fn();
    const strip = new ComposerActivityStrip({
      requestRender,
    } as never);

    strip.setActivity(
      createComposerActivity({
        mode: "streaming",
        previewText:
          "This is a deliberately long preview that should scroll across the strip.",
        leadActor: createActor({
          profileId: "agt_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          label: "oh-my-claude",
          startedAtMs: Date.now() - 5000,
          updatedAtMs: Date.now() - 1000,
          latestPreviewText:
            "This is a deliberately long preview that should scroll across the strip.",
          latestPreviewUpdatedAtMs: Date.now() - 1000,
        }),
      })
    );

    const before = strip
      .render(48)
      .map((line) => stripVTControlCharacters(line))
      .join("\n");

    vi.advanceTimersByTime(450);

    const after = strip
      .render(48)
      .map((line) => stripVTControlCharacters(line))
      .join("\n");

    expect(requestRender).toHaveBeenCalled();
    expect(before).toContain("oh-my-claude is streaming");
    expect(after).toContain("oh-my-claude is streaming");
    expect(before).not.toContain("Preview:");
    expect(after).not.toContain("Preview:");
    expect(after).not.toBe(before);

    strip.stop();
  });

  it("renders dispatching copy before the agent starts replying", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-14T12:00:00.000Z"));

    const strip = new ComposerActivityStrip({
      requestRender: vi.fn(),
    } as never);

    strip.setActivity(
      createComposerActivity({
        mode: "dispatching",
        hint: "Dispatching to @oh-my-claude...",
        previewText: "",
      })
    );

    const rendered = stripVTControlCharacters(strip.render(80).join("\n"));
    expect(rendered).toContain("Dispatching to @oh-my-claude...");

    strip.stop();
  });

  it("renders optimistic sending copy without duplicating the sending label", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-14T12:00:00.000Z"));

    const strip = new ComposerActivityStrip({
      requestRender: vi.fn(),
    } as never);

    strip.setActivity(
      createComposerActivity({
        mode: "sending",
        hint: "Sending: @hi-agent hello there",
        previewText: "",
      })
    );

    const rendered = stripVTControlCharacters(strip.render(80).join("\n"));
    expect(rendered).toContain("Sending: @hi-agent hello there");
    expect(rendered).not.toContain("sending · Sending: @hi-agent hello there");

    strip.stop();
  });

  it("colorizes the mentioned agent label inside sending copy", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-14T12:00:00.000Z"));
    const profileLabelColor = await import("../src/ui/profile-label-color");
    const colorizeAgentLabelSpy = vi
      .spyOn(profileLabelColor, "colorizeAgentLabel")
      .mockImplementation((label) => `[[${label}]]`);

    const strip = new ComposerActivityStrip({
      requestRender: vi.fn(),
    } as never);

    strip.setActivity(
      createComposerActivity({
        mode: "sending",
        rows: [
          createRow({
            key: "sending-hi-agent",
            mode: "sending",
            targetLabel: "@hi-agent",
            hint: "Sending: @hi-agent hello there",
          }),
        ],
        spaceMembersSnapshot: createActivitySpaceMembersSnapshot([
          createActivityAgentSnapshot({
            profileId: HI_AGENT_PROFILE_ID,
            profileName: "hi-agent",
          }),
        ]),
      })
    );

    const rawRendered = strip.render(80).join("\n");
    expect(rawRendered).toContain("Sending: [[@hi-agent]] hello there");
    expect(colorizeAgentLabelSpy).toHaveBeenCalledWith(
      "@hi-agent",
      expect.objectContaining({
        agentControllerRef: "builtin:codex",
        profileId: HI_AGENT_PROFILE_ID,
      }),
      expect.any(Object)
    );

    colorizeAgentLabelSpy.mockRestore();
    strip.stop();
  });

  it("colorizes the mentioned agent label inside dispatching copy", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-14T12:00:00.000Z"));
    const profileLabelColor = await import("../src/ui/profile-label-color");
    const colorizeAgentLabelSpy = vi
      .spyOn(profileLabelColor, "colorizeAgentLabel")
      .mockImplementation((label) => `[[${label}]]`);

    const strip = new ComposerActivityStrip({
      requestRender: vi.fn(),
    } as never);

    strip.setActivity(
      createComposerActivity({
        mode: "dispatching",
        rows: [
          createRow({
            key: "dispatching-hi-agent",
            mode: "dispatching",
            targetLabel: "@hi-agent",
            hint: "Dispatching to @hi-agent...",
          }),
        ],
        spaceMembersSnapshot: createActivitySpaceMembersSnapshot([
          createActivityAgentSnapshot({
            profileId: HI_AGENT_PROFILE_ID,
            profileName: "hi-agent",
          }),
        ]),
      })
    );

    const rawRendered = strip.render(80).join("\n");
    expect(rawRendered).toContain("Dispatching to [[@hi-agent]]...");
    expect(colorizeAgentLabelSpy).toHaveBeenCalledWith(
      "@hi-agent",
      expect.objectContaining({
        agentControllerRef: "builtin:codex",
        profileId: HI_AGENT_PROFILE_ID,
      }),
      expect.any(Object)
    );

    colorizeAgentLabelSpy.mockRestore();
    strip.stop();
  });

  it("matches duplicate agent names by their disambiguated mention alias", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-14T12:00:00.000Z"));
    const profileLabelColor = await import("../src/ui/profile-label-color");
    const colorizeAgentLabelSpy = vi
      .spyOn(profileLabelColor, "colorizeAgentLabel")
      .mockImplementation((label) => `[[${label}]]`);

    const strip = new ComposerActivityStrip({
      requestRender: vi.fn(),
    } as never);

    strip.setActivity(
      createComposerActivity({
        mode: "dispatching",
        rows: [
          createRow({
            key: "dispatching-reviewer-claude",
            mode: "dispatching",
            targetLabel: "@reviewer-claude",
            hint: "Dispatching to @reviewer-claude...",
          }),
        ],
        spaceMembersSnapshot: createActivitySpaceMembersSnapshot([
          createActivityAgentSnapshot({
            agentControllerRef: "builtin:claude-code",
            profileId: ORIGINAL_AGENT_PROFILE_ID,
            profileName: "Claude Agent",
          }),
          createActivityAgentSnapshot({
            mentionAlias: "reviewer-claude",
            profileId: ALIAS_AGENT_PROFILE_ID,
            profileName: "Claude Agent",
          }),
        ]),
      })
    );

    const rawRendered = strip.render(80).join("\n");
    expect(rawRendered).toContain("Dispatching to [[@reviewer-claude]]...");
    expect(colorizeAgentLabelSpy).toHaveBeenCalledWith(
      "@reviewer-claude",
      expect.objectContaining({
        agentControllerRef: "builtin:codex",
        profileId: ALIAS_AGENT_PROFILE_ID,
      }),
      expect.any(Object)
    );

    colorizeAgentLabelSpy.mockRestore();
    strip.stop();
  });

  it("renders warning copy without an animated spinner", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-14T12:00:00.000Z"));

    const strip = new ComposerActivityStrip({
      requestRender: vi.fn(),
    } as never);

    strip.setActivity(
      createComposerActivity({
        mode: "warning",
        hint: "Couldn't route @oh-my-claude right now",
        previewText: "",
      })
    );

    const rendered = stripVTControlCharacters(strip.render(80).join("\n"));
    expect(rendered).toContain("Couldn't route @oh-my-claude right now");
    expect(rendered).not.toContain("⠋");

    strip.stop();
  });
});

function createComposerActivity(
  input: Partial<ComposerActivityViewState> & {
    rows?: readonly ComposerActivityRowViewState[];
    actors?: readonly DispatchActivityActorViewState[];
    leadActor?: DispatchActivityActorViewState | null;
  } = {}
): ComposerActivityViewState {
  const leadActor =
    input.leadActor ??
    createActor({
      profileId: "agt_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      label: "oh-my-claude",
      startedAtMs: 1000,
      updatedAtMs: 2000,
      latestPreviewText: "",
      latestPreviewUpdatedAtMs: null,
    });
  const actors = input.actors ?? (leadActor ? [leadActor] : []);
  const rows =
    input.rows ??
    (input.mode === "idle"
      ? []
      : [
          createRow({
            key: "default-row",
            mode: input.mode ?? "replying",
            actors,
            leadActor,
            elapsedSeconds: input.elapsedSeconds ?? 3,
            previewText: input.previewText ?? "",
            hint: input.hint ?? null,
          }),
        ]);

  return {
    visible: input.visible ?? true,
    mode: input.mode ?? "replying",
    rows,
    overflowCount: input.overflowCount ?? 0,
    actors,
    leadActor,
    elapsedSeconds: input.elapsedSeconds ?? 3,
    previewText: input.previewText ?? "",
    hint: input.hint ?? null,
    spaceMembersSnapshot: input.spaceMembersSnapshot ?? null,
  };
}

function createRow(
  input: Partial<ComposerActivityRowViewState> & {
    key: string;
    mode: ComposerActivityRowViewState["mode"];
    leadActor?: DispatchActivityActorViewState | null;
  }
): ComposerActivityRowViewState {
  const leadActor = input.leadActor ?? null;
  return {
    key: input.key,
    mode: input.mode,
    targetLabel: input.targetLabel ?? leadActor?.label ?? null,
    actors: input.actors ?? (leadActor ? [leadActor] : []),
    leadActor,
    elapsedSeconds: input.elapsedSeconds ?? 0,
    previewText: input.previewText ?? "",
    hint: input.hint ?? null,
  };
}

function createActor(
  input: DispatchActivityActorViewState
): DispatchActivityActorViewState {
  return input;
}

const STRIP_TICK_STEP_MS = 150;
