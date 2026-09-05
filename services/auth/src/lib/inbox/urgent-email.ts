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
      `/o/${encodeURIComponent(organizationSlug)}/inbox`,
      baseUrl
    );
    itemUrl.searchParams.set("item", input.itemId);
    return itemUrl.toString();
  } catch {
    return null;
  }
}

export function buildInboxUrgentEmail(input: {
  purpose?: "invitation_review";
  from: string;
  inboxUrl: string;
  preview: string;
  title: string;
}): InboxUrgentEmailContent {
  const title = input.title.replace(/[\r\n]+/g, " ").trim();
  const escapedTitle = escapeHtml(title);
  const escapedPreview = escapeHtml(input.preview);
  const escapedInboxUrl = escapeHtml(input.inboxUrl);

  if (input.purpose === "invitation_review") {
    return {
      from: input.from,
      subject: title,
      text: `${title}\n\n${input.preview}\n\nReview request: ${input.inboxUrl}\n\nYou received this because you can approve invitations for this organization.`,
      html: `<!doctype html><html lang="en"><body><h1>${escapedTitle}</h1><p>${escapedPreview}</p><p><a href="${escapedInboxUrl}">Review request</a></p><p>You received this because you can approve invitations for this organization.</p></body></html>`,
    };
  }

  return {
    from: input.from,
    html: `<!doctype html>
<html lang="en">
  <body style="margin:0;background:#f6f7f9;color:#17191c;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">An urgent item needs your attention in OpenMeld.</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f6f7f9;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border:1px solid #e6e8eb;border-radius:16px;padding:32px;">
            <tr><td style="font-size:13px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:#c2410c;">Urgent item in your Inbox</td></tr>
            <tr><td style="padding-top:12px;font-size:24px;line-height:1.3;font-weight:650;">${escapedTitle}</td></tr>
            <tr><td style="padding-top:12px;font-size:15px;line-height:1.6;color:#5b616b;">${escapedPreview}</td></tr>
            <tr><td style="padding-top:24px;"><a href="${escapedInboxUrl}" style="display:inline-block;border-radius:10px;background:#17191c;color:#ffffff;font-size:14px;font-weight:600;line-height:20px;padding:10px 16px;text-decoration:none;">Open in OpenMeld</a></td></tr>
            <tr><td style="padding-top:28px;font-size:12px;line-height:1.5;color:#8a9099;">You received this because urgent Inbox email notifications are enabled for your account.</td></tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`,
    subject: `Urgent: ${title}`,
    text: `Urgent item in your Inbox

${title}

${input.preview}

Open in OpenMeld: ${input.inboxUrl}

You received this because urgent Inbox email notifications are enabled for your account.`,
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

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
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
