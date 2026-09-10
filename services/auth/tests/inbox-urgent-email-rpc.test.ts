import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthRpcEntrypoint } from "../src/lib/rpc/entrypoint";
import {
  applyDrizzleMigrations,
  createSqliteD1Harness,
  type SqliteD1Harness,
} from "./support/sqlite-d1-harness";

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

let harness: SqliteD1Harness;
let sendEmail: ReturnType<typeof vi.fn>;

beforeEach(() => {
  harness = createSqliteD1Harness();
  applyDrizzleMigrations(harness.database);
  sendEmail = vi.fn();
});

afterEach(() => {
  harness.close();
  vi.restoreAllMocks();
});

describe("urgent Inbox email RPC", () => {
  it("links invitation review emails to the same in-app request destination", async () => {
    seedIdentity({ organizationSlug: "acme-team" });
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
    const prepare = vi.spyOn(harness.db, "prepare");

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
    seedIdentity({ includeMembership: false });

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
    seedIdentity(identity);

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
    seedIdentity({ organizationSlug: "acme-team" });
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
    seedIdentity({});
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
    OPENMELD_DB: harness.db,
    WEB_APP_URL: "https://openmeld.ai",
  } as unknown as CloudflareBindings);
}

function seedIdentity(input: {
  email?: string;
  emailVerified?: boolean;
  includeMembership?: boolean;
  organizationSlug?: string;
}) {
  harness.run({
    params: [
      "user-felix",
      "Felix",
      input.email ?? "felix@amplift.ai",
      input.emailVerified === false ? 0 : 1,
      1,
      1,
    ],
    sql: `
      INSERT INTO users (
        id,
        name,
        email,
        email_verified,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `,
  });
  harness.run({
    params: ["org-acme", "Acme", input.organizationSlug ?? "acme", 1],
    sql: `
      INSERT INTO organizations (id, name, slug, created_at)
      VALUES (?, ?, ?, ?)
    `,
  });
  if (input.includeMembership === false) {
    return;
  }
  harness.run({
    params: ["member-felix", "org-acme", "user-felix", "owner", 1],
    sql: `
      INSERT INTO members (id, organization_id, user_id, role, created_at)
      VALUES (?, ?, ?, ?, ?)
    `,
  });
}
