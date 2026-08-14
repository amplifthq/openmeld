import { describe, expect, it } from "vitest";
import {
  openConnectorRuntimeActionSchema,
  openConnectorRuntimeActionSearchResultSchema,
  openConnectorRuntimeActionSuccessEnvelopeSchema,
} from "../../src/index";

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

  it("accepts the bounded runtime search result contract", () => {
    expect(
      openConnectorRuntimeActionSearchResultSchema.parse({
        authenticated: true,
        description: "List Gmail messages.",
        effect: "read",
        id: "gmail.fetch_emails",
        inputSchema: { type: "object" },
        name: "fetch_emails",
        outputSchema: { type: "object" },
        service: "gmail",
      })
    ).toMatchObject({
      effect: "read",
      id: "gmail.fetch_emails",
      service: "gmail",
    });
  });

  it("requires the execution-owned output schema on successful results", () => {
    const envelope = {
      data: { messages: [], resultSizeEstimate: 201 },
      message: "OK",
      meta: {
        actionId: "gmail.fetch_emails",
        auditPersisted: true,
        executionId: "provider-execution-1",
      },
      outputSchema: {
        properties: { resultSizeEstimate: { type: "integer" } },
        type: "object",
      },
      success: true,
    } as const;

    expect(
      openConnectorRuntimeActionSuccessEnvelopeSchema.parse(envelope)
    ).toEqual(envelope);
    expect(
      openConnectorRuntimeActionSuccessEnvelopeSchema.safeParse({
        ...envelope,
        outputSchema: undefined,
      }).success
    ).toBe(false);
  });
});
