import { describe, expect, it } from "vitest";
import { createAuthConfig } from "../src/configs/auth.config";
import { sendCloudflareEmail } from "../src/utils/email";
import { buildMagicLinkEmailContent } from "../src/utils/email-templates";

describe("sendCloudflareEmail", () => {
  it("sends lightweight HTML payloads through the Cloudflare Email Service binding", async () => {
    const sentMessages: unknown[] = [];

    await sendCloudflareEmail(
      {
        send(message) {
          sentMessages.push(message);
          return Promise.resolve({ messageId: "email_123" });
        },
      },
      {
        from: "OpenMeld <noreply@openmeld.invalid>",
        html: "<p>Hello</p>",
        replyTo: "support@openmeld.invalid",
        subject: "Hello",
        text: "Hello",
        to: "person@example.com",
      }
    );

    expect(sentMessages).toEqual([
      {
        from: "OpenMeld <noreply@openmeld.invalid>",
        html: "<p>Hello</p>",
        replyTo: "support@openmeld.invalid",
        subject: "Hello",
        text: "Hello",
        to: "person@example.com",
      },
    ]);
  });
});

describe("auth verification email config", () => {
  it("preserves the invitation accept redirect in verification email links", async () => {
    const sentMessages: Array<{
      text?: unknown;
      to?: unknown;
    }> = [];
    const config = createAuthConfig({
      AUTH_EMAIL: {
        send(message) {
          sentMessages.push(message);
          return Promise.resolve({ messageId: "email_123" });
        },
      },
      BETTER_AUTH_OPENMELD_SECRET:
        "test-secret-at-least-forty-four-characters-long",
      BETTER_AUTH_URL: "http://localhost:8788",
      WEB_APP_URL: "http://localhost:3000",
    });

    await config.emailVerification?.sendVerificationEmail?.({
      token: "token-123",
      url: "http://localhost:8788/api/auth/verify-email?token=token-123&callbackURL=http%3A%2F%2Flocalhost%3A3000%2Fverify-email%3Fredirect%3D%252Faccept-invitation%253FinvitationId%253Dinv-123",
      user: {
        email: "invitee@example.com",
      },
    } as never);

    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0]?.to).toBe("invitee@example.com");
    expect(sentMessages[0]?.text).toContain(
      "http://localhost:3000/verify-email?token=token-123&redirect=%2Faccept-invitation%3FinvitationId%3Dinv-123"
    );
  });
});

describe("email content builders", () => {
  it("escapes dynamic values in HTML while keeping plain text readable", () => {
    const content = buildMagicLinkEmailContent({
      brandName: "OpenMeld <Prod>",
      expiresInSeconds: 300,
      magicLinkUrl: "https://openmeld.invalid/magic-link?token=<token>&next=/",
    });

    expect(content.html).toContain("OpenMeld &lt;Prod&gt;");
    expect(content.html).toContain(
      "https://openmeld.invalid/magic-link?token=&lt;token&gt;&amp;next=/"
    );
    expect(content.text).toContain("OpenMeld <Prod>");
    expect(content.text).toContain(
      "https://openmeld.invalid/magic-link?token=<token>&next=/"
    );
  });
});
