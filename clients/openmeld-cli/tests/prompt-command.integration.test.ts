import { buildAgentFacingPublicationModeGuideLines } from "@openmeld/space-mesh";
import { describe, expect, it, vi } from "vitest";
import { runPrompt } from "../src/commands/prompt";
import { readBundledOpenMeldCliSkillDocumentByPath } from "../src/skills/bundled-assets";
import { withCapturedStdio } from "./helpers/fs";

const HUMAN_MENTION_LITERAL_GUIDANCE_PATTERN =
  /`@Name\(wake\)`, `@Name\(reference\)`, or\s+`@Name\(mention\)`/;

vi.mock("../src/skills/installation-inventory", () => ({
  collectSkillsReadinessSnapshot: vi.fn(async () => ({
    status: "up_to_date",
    targetCount: 1,
    summary: {
      healthy: 1,
      missing: 0,
      outdated: 0,
      externalConflict: 0,
    },
  })),
}));

describe("prompt command", () => {
  it("prints the guide entry by default instead of raw skill markdown", async () => {
    const raw = await readBundledOpenMeldCliSkillDocumentByPath("SKILL.md");
    const { plainStdout } = await withCapturedStdio(async () => {
      await runPrompt();
    });

    expect(plainStdout).toContain("OpenMeld guide entry.");
    expect(plainStdout).toContain("openmeld prompt onboarding");
    expect(plainStdout).not.toBe(raw);
  });

  it("prints raw markdown for a selected topic with --raw", async () => {
    const expected = await readBundledOpenMeldCliSkillDocumentByPath(
      "references/commands.md"
    );
    const { stdout } = await withCapturedStdio(async () => {
      await runPrompt({
        topic: "commands",
        raw: true,
      });
    });

    expect(stdout).toBe(expected);
    expect(stdout).toMatch(HUMAN_MENTION_LITERAL_GUIDANCE_PATTERN);
  });

  it("emits canonical StructuredGuidePayload JSON with --json", async () => {
    const { stdout } = await withCapturedStdio(async () => {
      await runPrompt({
        topic: "space",
        json: true,
      });
    });

    const payload = JSON.parse(stdout.trim()) as {
      schemaVersion: number;
      summary: string;
      forHumans: { steps: string[] };
      forAgents: { commands: string[]; notes: string[] };
    };

    expect(payload.schemaVersion).toBe(1);
    expect(payload.summary).toContain("Use this guide for `openmeld space`");
    expect(payload.summary).toContain("structured actions");
    expect(payload.forHumans.steps.length).toBeGreaterThan(0);
    expect(payload.forHumans.steps).toContain(
      "For structured Space replies, leave `activationTargets`, `referenceTargets`, and `mentionTargets` empty unless you intentionally address another profile."
    );
    expect(payload.forAgents.commands).toContain("openmeld prompt space --raw");
    expect(payload.forAgents.notes).toContain(
      "`activationTargets` is only for waking another Agent Profile in the Space. It is not the sender, reply recipient, or human mention target."
    );
    expect(payload.forAgents.notes).toContain(
      "`referenceTargets` is only for Agent Reference context; `mentionTargets` is only for Human Mentions that should notify a person."
    );
    expect(payload.forAgents.notes).toContain(
      "For a normal reply to the current Wake, use `post_message` with empty `activationTargets`, `referenceTargets`, and `mentionTargets`."
    );
    expect(payload.forAgents.notes).toContain(
      "Use `openmeld space send --plain` only when canonical Agent Wake, Agent Reference, or Human Mention syntax should be quoted as literal text instead of resolved as Space addressing."
    );
    for (const line of buildAgentFacingPublicationModeGuideLines()) {
      expect(payload.forAgents.notes).toContain(line);
    }
  });
});
