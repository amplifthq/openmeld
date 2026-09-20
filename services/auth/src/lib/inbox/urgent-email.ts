import { buildInboxEmailContent } from "@openmeld/auth/server";

const TRANSIENT_EMAIL_ERROR_CODES = new Set([
  "E_DAILY_LIMIT_EXCEEDED",
  "E_DELIVERY_FAILED",
  "E_INTERNAL_SERVER_ERROR",
  "E_RATE_LIMIT_EXCEEDED",
  "EAI_AGAIN",
  "ECONNRESET",
  "ETIMEDOUT",
]);

const SENDER_CONFIGURATION_ERROR_CODES = new Set([
  "E_SENDER_DOMAIN_NOT_AVAILABLE",
  "E_SENDER_NOT_VERIFIED",
]);

export type InboxUrgentEmailContent = {
  from: string;
  html: string;
  subject: string;
  text: string;
};

export type InboxUrgentEmailFailure = {
  code:
    | "email_sender_not_verified"
    | "email_send_rejected"
    | "email_send_transient";
  providerCode: string | null;
  retryable: boolean;
};

export function buildInboxItemUrl(input: {
  invitationRequestId?: string;
  itemId: string;
  organizationSlug: string;
  webAppUrl: string | undefined;
}): string | null {
  try {
    const baseUrl = new URL(input.webAppUrl ?? "");
    const organizationSlug = input.organizationSlug.trim();
    if (
      !(baseUrl.protocol === "https:" || baseUrl.protocol === "http:") ||
      baseUrl.username.length > 0 ||
      baseUrl.password.length > 0 ||
      organizationSlug.length === 0 ||
      organizationSlug === "." ||
      organizationSlug === ".."
    ) {
      return null;
    }
    const itemUrl = new URL(
      input.invitationRequestId
        ? `/o/${encodeURIComponent(organizationSlug)}/settings/invitations`
        : `/o/${encodeURIComponent(organizationSlug)}/inbox`,
      baseUrl
    );
    itemUrl.searchParams.set(
      input.invitationRequestId ? "requestId" : "item",
      input.invitationRequestId ?? input.itemId
    );
    return itemUrl.toString();
  } catch {
    return null;
  }
}

export async function buildInboxUrgentEmail(input: {
  purpose?: "invitation_review";
  from: string;
  inboxUrl: string;
  preview: string;
  title: string;
}): Promise<InboxUrgentEmailContent> {
  const title = input.title.replace(/[\r\n]+/g, " ").trim();
  return {
    ...(await buildInboxEmailContent({ ...input, title })),
    from: input.from,
    subject: input.purpose === "invitation_review" ? title : `Urgent: ${title}`,
  };
}

export function classifyInboxEmailError(
  error: unknown
): InboxUrgentEmailFailure {
  const providerCode = readProviderErrorCode(error);
  if (
    providerCode !== null &&
    SENDER_CONFIGURATION_ERROR_CODES.has(providerCode)
  ) {
    return {
      code: "email_sender_not_verified",
      providerCode,
      retryable: false,
    };
  }
  if (providerCode !== null && TRANSIENT_EMAIL_ERROR_CODES.has(providerCode)) {
    return {
      code: "email_send_transient",
      providerCode,
      retryable: true,
    };
  }
  return {
    code: "email_send_rejected",
    providerCode,
    retryable: false,
  };
}

function readProviderErrorCode(error: unknown): string | null {
  if (!(typeof error === "object" && error !== null && "code" in error)) {
    return null;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && code.trim().length > 0
    ? code.trim().toUpperCase()
    : null;
}
