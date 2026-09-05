export type VerificationEmailHtmlInput = {
  verificationUrl: string;
  brandName: string;
  expiresInSeconds: number;
};

export type MagicLinkEmailHtmlInput = {
  magicLinkUrl: string;
  brandName: string;
  expiresInSeconds: number;
};

export type OrganizationInvitationEmailInput = {
  invitationUrl: string;
  brandName: string;
  organizationName: string;
  inviterName: string;
  role: string;
  expiresAt: Date;
};

export type BuiltEmailContent = {
  html: string;
  text: string;
};

export function buildVerificationEmailContent({
  verificationUrl,
  brandName,
  expiresInSeconds,
}: VerificationEmailHtmlInput): BuiltEmailContent {
  const expiresInMinutes = resolveExpiryMinutes(expiresInSeconds);
  return buildActionEmailContent({
    actionLabel: "Verify email",
    actionUrl: verificationUrl,
    body: `Confirm your email address to finish setting up your ${brandName} account.`,
    brandName,
    expiryText: `This verification link expires in ${expiresInMinutes} minutes for security.`,
    heading: "Verify your email",
  });
}

export function buildMagicLinkEmailContent({
  magicLinkUrl,
  brandName,
  expiresInSeconds,
}: MagicLinkEmailHtmlInput): BuiltEmailContent {
  const expiresInMinutes = resolveExpiryMinutes(expiresInSeconds);
  return buildActionEmailContent({
    actionLabel: `Continue to ${brandName}`,
    actionUrl: magicLinkUrl,
    body: `A sign-in link was requested for your ${brandName} account.`,
    brandName,
    expiryText: `This link expires in ${expiresInMinutes} minutes for security.`,
    heading: "Sign in with magic link",
  });
}

export function buildOrganizationInvitationEmailContent({
  invitationUrl,
  brandName,
  organizationName,
  inviterName,
  role,
  expiresAt,
}: OrganizationInvitationEmailInput): BuiltEmailContent {
  const formattedExpiry = formatInvitationExpiry(expiresAt);
  return buildActionEmailContent({
    actionLabel: "Accept invitation",
    actionUrl: invitationUrl,
    body: `${inviterName} invited you to join ${organizationName} on ${brandName} as ${formatRoleLabel(role)}.`,
    brandName,
    expiryText: `This invitation expires ${formattedExpiry}.`,
    heading: `Join ${organizationName}`,
  });
}

export function buildSpaceInvitationEmailContent(input: {
  invitationUrl: string;
  brandName: string;
  organizationName: string;
  spaceName: string;
  inviterName: string;
  expiresAt: Date;
}): BuiltEmailContent {
  return buildActionEmailContent({
    actionLabel: "Review invitation",
    actionUrl: input.invitationUrl,
    body: `${input.inviterName} invited you to ${input.spaceName} in ${input.organizationName}. Accepting will join the organization as a member and give you access to this Space.`,
    brandName: input.brandName,
    heading: `Join ${input.spaceName}`,
    expiryText: `This invitation expires ${formatInvitationExpiry(input.expiresAt)}.`,
  });
}

function buildActionEmailContent({
  actionLabel,
  actionUrl,
  body,
  brandName,
  expiryText,
  heading,
}: {
  actionLabel: string;
  actionUrl: string;
  body: string;
  brandName: string;
  expiryText: string;
  heading: string;
}): BuiltEmailContent {
  const escapedActionLabel = escapeHtml(actionLabel);
  const escapedActionUrl = escapeHtml(actionUrl);
  const escapedBody = escapeHtml(body);
  const escapedBrandName = escapeHtml(brandName);
  const escapedExpiryText = escapeHtml(expiryText);
  const escapedHeading = escapeHtml(heading);
  const text = [
    brandName,
    "",
    heading,
    "",
    body,
    "",
    `${actionLabel}: ${actionUrl}`,
    "",
    "If you did not request this email, you can safely ignore it.",
    "",
    expiryText,
  ].join("\n");

  return {
    html: `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapedHeading}</title>
  </head>
  <body style="margin:0;background:#f6f8fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#111827;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f6f8fb;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
            <tr>
              <td style="padding:28px 32px 8px;font-size:16px;font-weight:700;color:#111827;">${escapedBrandName}</td>
            </tr>
            <tr>
              <td style="padding:8px 32px 32px;">
                <h1 style="margin:0 0 16px;font-size:24px;line-height:32px;font-weight:700;color:#111827;">${escapedHeading}</h1>
                <p style="margin:0 0 24px;font-size:16px;line-height:24px;color:#374151;">${escapedBody}</p>
                <p style="margin:0 0 24px;">
                  <a href="${escapedActionUrl}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;border-radius:8px;padding:12px 18px;font-size:15px;font-weight:700;">${escapedActionLabel}</a>
                </p>
                <p style="margin:0 0 24px;font-size:14px;line-height:22px;color:#4b5563;">If you did not request this email, you can safely ignore it.</p>
                <hr style="border:0;border-top:1px solid #e5e7eb;margin:0 0 18px;">
                <p style="margin:0;font-size:13px;line-height:20px;color:#6b7280;">${escapedExpiryText}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`,
    text,
  };
}

function resolveExpiryMinutes(expiresInSeconds: number): number {
  return Math.max(1, Math.round(expiresInSeconds / 60));
}

function formatInvitationExpiry(expiresAt: Date): string {
  const timestamp = expiresAt.getTime();
  if (!Number.isFinite(timestamp)) {
    throw new Error("Organization invitation is missing a valid expiration");
  }

  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    timeZone: "UTC",
    timeZoneName: "short",
    year: "numeric",
  }).format(expiresAt);
}

function formatRoleLabel(role: string): string {
  const normalized = role.trim().toLowerCase();
  if (
    normalized === "owner" ||
    normalized === "admin" ||
    normalized === "member"
  ) {
    return normalized;
  }

  throw new Error(`Unsupported organization invitation role: ${role}`);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
