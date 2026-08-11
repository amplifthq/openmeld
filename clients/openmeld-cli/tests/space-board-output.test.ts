import type { SpaceBoardResponse } from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import { formatSpaceBoardOutput } from "../src/space/board-output";

const board: SpaceBoardResponse = {
  space: {
    id: "space-1",
    name: "Launch Room",
    purpose: "Coordinate the launch.",
    guide: "Keep updates concise.\nSurface blockers immediately.",
  },
  members: {
    totalCount: 4,
    humanCount: 2,
    agentCount: 2,
    centerAgentPresent: true,
  },
  workingNow: [
    {
      profileId: "agt_11111111-1111-4111-8111-111111111111",
      profileName: "Builder",
      startedAt: "2026-07-15T01:00:00.000Z",
    },
  ],
  recentOutcomes: [
    {
      at: "2026-07-15T00:45:00.000Z",
      profileId: "agt_22222222-2222-4222-8222-222222222222",
      profileName: null,
      outcome: "replied",
    },
  ],
};

describe("Space Board CLI output", () => {
  it("emits the canonical response unchanged for --json", () => {
    const output = formatSpaceBoardOutput(board, { json: true });

    expect(output).toBe(JSON.stringify(board));
    expect(JSON.parse(output)).toEqual(board);
  });

  it("renders compact Markdown by default", () => {
    expect(formatSpaceBoardOutput(board, { json: false })).toBe(
      [
        "# Space: Launch Room",
        "Purpose: Coordinate the launch.",
        "## Guide (steward-maintained)",
        "Keep updates concise.",
        "Surface blockers immediately.",
        "## Members",
        "2 people, 2 agents, Center Agent present",
        "## Working now",
        "- Builder (started 2026-07-15T01:00:00.000Z)",
        "## Recent outcomes (last 10)",
        "- 2026-07-15T00:45:00.000Z agt_22222222-2222-4222-8222-222222222222: replied",
      ].join("\n")
    );
  });

  it("renders empty and nullable Board sections without failing", () => {
    expect(
      formatSpaceBoardOutput(
        {
          space: { id: "empty", name: "Empty", purpose: null, guide: null },
          members: {
            totalCount: 0,
            humanCount: 0,
            agentCount: 0,
            centerAgentPresent: false,
          },
          workingNow: [],
          recentOutcomes: [],
        },
        { json: false }
      )
    ).toBe(
      [
        "# Space: Empty",
        "Purpose: -",
        "## Guide (steward-maintained)",
        "No guide set.",
        "## Members",
        "0 people, 0 agents",
        "## Working now",
        "(none)",
        "## Recent outcomes (last 10)",
        "(none)",
      ].join("\n")
    );
  });
});
