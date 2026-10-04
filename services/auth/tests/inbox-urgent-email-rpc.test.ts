import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createPostgresHarness,
  Pool,
  type PostgresHarness,
  postgresTestBinding,
} from "../../../tooling/postgresql/test-harness";
import { AuthRpcEntrypoint } from "../src/lib/rpc/entrypoint";

const executionContext = {
  exports: {},
  passThroughOnException: () => undefined,
  props: {},
  waitUntil: () => undefined,
} as unknown as ExecutionContext;

const validRequest = {
  deliveryId: "delivery-urgent-1",
  itemId: "item-urgent-1",
  organizationId: "org-acme",
  preview: "Center Agent needs your approval before it can publish.",
  title: "Approve the release",
  userId: "user-felix",
} as const;

let harness: PostgresHarness;
let sendEmail: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  harness = await createPostgresHarness();

  sendEmail = vi.fn();
});

afterEach(async () => {
  await harness.close();
  vi.restoreAllMocks();
});

describe("urgent Inbox email RPC", () => {
  it("links invitation review emails to the same in-app request destination", async () => {
    await seedIdentity({ organizationSlug: "acme-team" });
    sendEmail.mockResolvedValue({ messageId: "review-mail" });
    await expect(
      createRpc().sendInboxUrgentEmail({
        ...validRequest,
        purpose: "invitation_review",
        invitationRequestId: "request/one?other=value",
      })
    ).resolves.toMatchObject({ status: "sent" });
    const message = sendEmail.mock.calls[0]?.[0] as EmailMessageBuilder;
    expect(message.text).toContain(
      "https://openmeld.ai/o/acme-team/settings/invitations?requestId=request%2Fone%3Fother%3Dvalue"
    );
    expect(message.text).not.toContain("/inbox?item=");
  });
  it("rejects non-strict input before reading identity data or sending", async () => {
    const rpc = createRpc();
    const prepare = vi.spyOn(Pool.prototype, "query");

    await expect(
      rpc.sendInboxUrgentEmail({
        ...validRequest,
        recipientEmail: "attacker@example.com",
      })
    ).resolves.toEqual({
      code: "email_request_invalid",
      deliveryId: validRequest.deliveryId,
      retryable: false,
      status: "failed",
    });
    expect(prepare).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("suppresses delivery when the user is not a current organization member", async () => {
    await seedIdentity({ includeMembership: false });

    await expect(
      createRpc().sendInboxUrgentEmail(validRequest)
    ).resolves.toEqual({
      deliveryId: validRequest.deliveryId,
      reason: "recipient_not_member",
      status: "suppressed",
    });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it.each([
    { email: "", emailVerified: true, state: "missing" },
    {
      email: "felix@amplift.ai",
      emailVerified: false,
      state: "unverified",
    },
  ])("suppresses delivery when the current email is $state", async (identity) => {
    await seedIdentity(identity);

    await expect(
      createRpc().sendInboxUrgentEmail(validRequest)
    ).resolves.toEqual({
      deliveryId: validRequest.deliveryId,
      reason: "recipient_has_no_email",
      status: "suppressed",
    });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("sends native English text and HTML with a safe Inbox link", async () => {
    await seedIdentity({ organizationSlug: "acme-team" });
    sendEmail.mockResolvedValue({ messageId: "cf-message-123" });
    const rpc = createRpc();

    await expect(
      rpc.sendInboxUrgentEmail({
        ...validRequest,
        itemId: "item/urgent?source=email",
        preview: "Review <script>alert('unsafe')</script> & approve.",
        title: "Approve <Production>\r\nnow",
      })
    ).resolves.toEqual({
      deliveryId: validRequest.deliveryId,
      messageId: "cf-message-123",
      status: "sent",
    });

    expect(sendEmail).toHaveBeenCalledOnce();
    const message = sendEmail.mock.calls[0]?.[0] as EmailMessageBuilder;
    expect(message).toMatchObject({
      from: "OpenMeld <noreply@openmeld.invalid>",
      subject: "Urgent: Approve <Production> now",
      to: "felix@amplift.ai",
    });
    expect(message.text).toContain("Needs your attention");
    expect(message.text).toContain(
      "https://openmeld.ai/o/acme-team/inbox?item=item%2Furgent%3Fsource%3Demail"
    );
    expect(message.html).toContain("Approve &lt;Production&gt;");
    expect(message.html).toContain(
      "Review &lt;script&gt;alert(&#x27;unsafe&#x27;)&lt;/script&gt; &amp; approve."
    );
    expect(message.html).not.toContain("<script>");
  });

  it.each([
    {
      cloudflareCode: "E_RATE_LIMIT_EXCEEDED",
      expectedCode: "email_send_transient",
      retryable: true,
    },
    {
      cloudflareCode: "E_INTERNAL_SERVER_ERROR",
      expectedCode: "email_send_transient",
      retryable: true,
    },
    {
      cloudflareCode: "E_SENDER_NOT_VERIFIED",
      expectedCode: "email_sender_not_verified",
      retryable: false,
    },
    {
      cloudflareCode: "E_VALIDATION_ERROR",
      expectedCode: "email_send_rejected",
      retryable: false,
    },
  ])("maps $cloudflareCode to $expectedCode without leaking email content", async ({
    cloudflareCode,
    expectedCode,
    retryable,
  }) => {
    await seedIdentity({});
    const providerError = Object.assign(new Error("provider detail"), {
      code: cloudflareCode,
    });
    sendEmail.mockRejectedValue(providerError);
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    await expect(
      createRpc().sendInboxUrgentEmail(validRequest)
    ).resolves.toEqual({
      code: expectedCode,
      deliveryId: validRequest.deliveryId,
      retryable,
      status: "failed",
    });

    const serializedLogs = JSON.stringify(consoleError.mock.calls);
    expect(serializedLogs).not.toContain("felix@amplift.ai");
    expect(serializedLogs).not.toContain(validRequest.title);
    expect(serializedLogs).not.toContain(validRequest.preview);
    expect(serializedLogs).not.toContain("provider detail");
  });
});

function createRpc(): AuthRpcEntrypoint {
  return new AuthRpcEntrypoint(executionContext, {
    AUTH_EMAIL: { send: sendEmail },
    AUTH_FROM_EMAIL: "OpenMeld <noreply@openmeld.invalid>",
    AUTH_WORKER_NODE_ENV: "test",
    OPENMELD_POSTGRESQL: postgresTestBinding(harness.db),
    WEB_APP_URL: "https://openmeld.ai",
  } as unknown as CloudflareBindings);
}

async function seedIdentity(input: {
  email?: string;
  emailVerified?: boolean;
  includeMembership?: boolean;
  organizationSlug?: string;
}) {
  await harness.query({
    values: [
      "user-felix",
      "Felix",
      input.email ?? "felix@amplift.ai",
      input.emailVerified === false ? 0 : 1,
      1,
      1,
    ],
    text: `
      INSERT INTO "openmeld"."users" (
        id,
        name,
        email,
        email_verified,
        created_at,
        updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6)
    `,
  });
  await harness.query({
    values: ["org-acme", "Acme", input.organizationSlug ?? "acme", 1],
    text: `
      INSERT INTO "openmeld"."organizations" (id, name, slug, created_at)
      VALUES ($1, $2, $3, $4)
    `,
  });
  if (input.includeMembership === false) {
    return;
  }
  await harness.query({
    values: ["member-felix", "org-acme", "user-felix", "owner", 1],
    text: `
      INSERT INTO "openmeld"."members" (id, organization_id, user_id, role, created_at)
      VALUES ($1, $2, $3, $4, $5)
    `,
  });
}
