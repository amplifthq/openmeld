import { STRUCTURED_GUIDE_SCHEMA_VERSION } from "@openmeld/schemas/schemas";
import { describe, expect, it } from "vitest";
import { buildStructuredGuidePayload } from "../src/runtime/structured-guide-payload";

describe("structured guide payload runtime builder", () => {
  it("adds schemaVersion and normalizes optional arrays", () => {
    const payload = buildStructuredGuidePayload({
      summary: "guide summary",
      humanSteps: ["step-1"],
    });

    expect(payload).toEqual({
      schemaVersion: STRUCTURED_GUIDE_SCHEMA_VERSION,
      summary: "guide summary",
      forAgents: {
        requiredArguments: [],
        optionalArguments: [],
        commands: [],
        notes: [],
      },
      forHumans: {
        steps: ["step-1"],
      },
    });
  });

  it("throws on invalid guide input", () => {
    expect(() =>
      buildStructuredGuidePayload({
        summary: "",
        humanSteps: ["step-1"],
      })
    ).toThrow("invalid structured guide payload");
  });
});
