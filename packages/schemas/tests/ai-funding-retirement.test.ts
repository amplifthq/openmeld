import { describe, expect, it } from "vitest";
import {
  remoteAiProviderAuthorizationSchema,
  updateOrganizationAiBillingSchema,
} from "../src/schemas/ai-billing";
import { aiUsageRecordSchema } from "../src/schemas/ai-usage";

describe("retired internal AI funding", () => {
  it("rejects internal funding at authorization and settings boundaries", () => {
    expect(
      remoteAiProviderAuthorizationSchema.safeParse({
        source: "internal",
        apiKey: "sk-or-retired-internal-key",
      }).success
    ).toBe(false);
    expect(
      updateOrganizationAiBillingSchema.safeParse({ source: "internal" })
        .success
    ).toBe(false);
  });

  it("keeps historical usage attribution readable", () => {
    expect(aiUsageRecordSchema.shape.fundingSource.parse("internal")).toBe(
      "internal"
    );
  });
});
