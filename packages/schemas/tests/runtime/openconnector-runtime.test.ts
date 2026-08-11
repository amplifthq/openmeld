import { describe, expect, it } from "vitest";
import { openConnectorRuntimeActionSchema } from "../../src/index";

const ACTION = {
  asyncLifecycle: null,
  description: "Permanently remove one project.",
  execution: {
    catalogOnly: false,
    locallyExecutable: true,
    needsCredential: true,
    noAuthRunnable: false,
    requiredAuthTypes: ["api_key"],
  },
  followUpActions: [],
  id: "posthog.project_operation",
  inputSchema: { type: "object" },
  name: "Project operation",
  outputSchema: { type: "object" },
  providerPermissions: [],
  requiredScopes: ["project:write"],
  service: "posthog",
} as const;

describe("OpenConnector runtime action contract", () => {
  it("accepts first-class destructive effect metadata", () => {
    expect(
      openConnectorRuntimeActionSchema.parse({
        ...ACTION,
        effect: "destructive",
      })
    ).toMatchObject({ effect: "destructive" });
  });

  it("keeps the effect vocabulary closed", () => {
    expect(
      openConnectorRuntimeActionSchema.safeParse({
        ...ACTION,
        effect: "dangerous",
      }).success
    ).toBe(false);
  });
});
