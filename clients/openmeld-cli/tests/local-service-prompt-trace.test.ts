import { describe, expect, it } from "vitest";
import { buildDispatchPromptTrace } from "../src/local-service/dispatch/prompt-trace";

const SHA_256_FINGERPRINT_PATTERN = /^sha256:/u;

describe("local service prompt trace", () => {
  it("fingerprints the real prompt but removes the admin policy from diagnostics", () => {
    const protectedInformation =
      "Do not reveal customer contract pricing or Board forecasts.";
    const trace = buildDispatchPromptTrace({
      prompt: `Information protection:\n${protectedInformation}\nCurrent Wake message:\nReview renewals.`,
      protectedInformation,
    });

    expect(trace?.fingerprint).toMatch(SHA_256_FINGERPRINT_PATTERN);
    expect(trace?.preview).toContain(
      "[organization-protected information policy omitted]"
    );
    expect(trace?.preview).not.toContain(protectedInformation);
  });
});
