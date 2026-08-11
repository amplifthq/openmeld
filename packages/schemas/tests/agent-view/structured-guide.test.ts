import { describe, expect, it } from "vitest";
import {
  STRUCTURED_GUIDE_SCHEMA_VERSION,
  structuredGuidePayloadFromInputSchema,
  structuredGuidePayloadSchema,
} from "../../src/index";

describe("agent-view structured guide schema", () => {
  it("builds payload from dual-view input shape", () => {
    const result = structuredGuidePayloadFromInputSchema.safeParse({
      summary: "start in agent view requires explicit agent arguments.",
      humanSteps: ["openmeld view human", "openmeld start"],
      agentRequiredArgs: ["--kind agent"],
      agentOptionalArgs: ["--profile-id <id>"],
      agentCommands: ["openmeld start --kind agent --profile-id <id>"],
      notes: ["skills source: ~/.openmeld/skills"],
    });

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }

    expect(result.data).toEqual({
      schemaVersion: STRUCTURED_GUIDE_SCHEMA_VERSION,
      summary: "start in agent view requires explicit agent arguments.",
      forAgents: {
        requiredArguments: ["--kind agent"],
        optionalArguments: ["--profile-id <id>"],
        commands: ["openmeld start --kind agent --profile-id <id>"],
        notes: ["skills source: ~/.openmeld/skills"],
      },
      forHumans: {
        steps: ["openmeld view human", "openmeld start"],
      },
    });
  });

  it("fills optional arrays with empty arrays", () => {
    const result = structuredGuidePayloadFromInputSchema.safeParse({
      summary: "demo",
      humanSteps: ["step-1"],
    });

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }

    expect(result.data.forAgents).toEqual({
      requiredArguments: [],
      optionalArguments: [],
      commands: [],
      notes: [],
    });
  });

  it("rejects payload when schemaVersion is missing", () => {
    const result = structuredGuidePayloadSchema.safeParse({
      summary: "demo",
      forAgents: {
        requiredArguments: [],
        optionalArguments: [],
        commands: [],
        notes: [],
      },
      forHumans: {
        steps: [],
      },
    });
    expect(result.success).toBe(false);
  });
});
