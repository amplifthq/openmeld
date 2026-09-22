import { describe, expect, it } from "vitest";
import { verifyGitHubAppWebhookSignature } from "../src/space/application/github-app-webhook-signature";

const GITHUB_VENDOR_SECRET = "It's a Secret to Everybody";
const GITHUB_VENDOR_PAYLOAD = "Hello, World!";
const GITHUB_VENDOR_SIGNATURE =
  "sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17";

describe("GitHub App webhook signature", () => {
  it("accepts GitHub's published HMAC test vector and fails closed otherwise", async () => {
    await expect(
      verifyGitHubAppWebhookSignature({
        rawBody: GITHUB_VENDOR_PAYLOAD,
        secret: GITHUB_VENDOR_SECRET,
        signature256: GITHUB_VENDOR_SIGNATURE,
      })
    ).resolves.toBe(true);

    await expect(
      verifyGitHubAppWebhookSignature({
        rawBody: GITHUB_VENDOR_PAYLOAD,
        secret: GITHUB_VENDOR_SECRET,
        signature256:
          "sha256=0000000000000000000000000000000000000000000000000000000000000000",
      })
    ).resolves.toBe(false);
    await expect(
      verifyGitHubAppWebhookSignature({
        rawBody: GITHUB_VENDOR_PAYLOAD,
        secret: "",
        signature256: GITHUB_VENDOR_SIGNATURE,
      })
    ).resolves.toBe(false);
    await expect(
      verifyGitHubAppWebhookSignature({
        rawBody: GITHUB_VENDOR_PAYLOAD,
        secret: GITHUB_VENDOR_SECRET,
        signature256: null,
      })
    ).resolves.toBe(false);
  });
});
