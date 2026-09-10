import type { ActionEmailProps } from "./action-email";

export type VerificationEmailProps = {
  verificationUrl: string;
  brandName: string;
  expiresInSeconds: number;
};
export type MagicLinkEmailProps = {
  magicLinkUrl: string;
  brandName: string;
  expiresInSeconds: number;
};
export type OrganizationInvitationEmailProps = {
  invitationUrl: string;
  brandName: string;
  organizationName: string;
  inviterName: string;
  role: string;
  expiresAt: Date;
};
export type SpaceInvitationEmailProps = Omit<
  OrganizationInvitationEmailProps,
  "role"
> & { spaceName: string; audience?: "organization" | "guest" };
export type InboxEmailProps = {
  inboxUrl: string;
  preview: string;
  title: string;
};

const expiryMinutes = (seconds: number) =>
  Math.max(1, Math.round(seconds / 60));
function expiry(date: Date) {
  if (!Number.isFinite(date.getTime())) {
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
  }).format(date);
}
function roleLabel(role: string) {
  const normalized = role.trim().toLowerCase();
  if (
    normalized === "owner" ||
    normalized === "admin" ||
    normalized === "member"
  ) {
    return normalized === "member" ? "a member" : `an ${normalized}`;
  }
  throw new Error(`Unsupported organization invitation role: ${role}`);
}
export function verificationContent(
  input: VerificationEmailProps
): ActionEmailProps {
  return {
    brandName: input.brandName,
    heading: "Verify your email",
    body: `Confirm this email address to finish setting up your ${input.brandName} account.`,
    actionLabel: "Verify email",
    actionUrl: input.verificationUrl,
    note: `Link expires in ${expiryMinutes(input.expiresInSeconds)} minutes.`,
    footer: "If you didn’t request this, you can ignore this email.",
  };
}
export function magicLinkContent(input: MagicLinkEmailProps): ActionEmailProps {
  return {
    brandName: input.brandName,
    heading: `Sign in to ${input.brandName}`,
    body: "Use this link to sign in. No password needed.",
    actionLabel: "Sign in",
    actionUrl: input.magicLinkUrl,
    note: `Link expires in ${expiryMinutes(input.expiresInSeconds)} minutes.`,
    footer: "If you didn’t request this, you can ignore this email.",
  };
}
export function organizationInvitationContent(
  input: OrganizationInvitationEmailProps
): ActionEmailProps {
  return {
    brandName: input.brandName,
    heading: `Join ${input.organizationName}`,
    body: `${input.inviterName} invited you to join ${input.organizationName} as ${roleLabel(input.role)}.`,
    actionLabel: "Review invitation",
    actionUrl: input.invitationUrl,
    note: `Expires ${expiry(input.expiresAt)}.`,
    footer: "You’ll join only after accepting the invitation.",
  };
}
export function spaceInvitationContent(
  input: SpaceInvitationEmailProps
): ActionEmailProps {
  return {
    brandName: input.brandName,
    heading: `Join ${input.spaceName}`,
    body: `${input.inviterName} invited you to this Space in ${input.organizationName}.`,
    actionLabel: "Review invitation",
    actionUrl: input.invitationUrl,
    note:
      input.audience === "guest"
        ? `Sign in to join this Space as a guest. This does not make you a member of ${input.organizationName} or give you access to its other Spaces.`
        : `Accepting joins ${input.organizationName} as a member and adds you to this Space.`,
    footer: `Expires ${expiry(input.expiresAt)}.`,
  };
}
export function invitationReviewContent(
  input: InboxEmailProps
): ActionEmailProps {
  return {
    brandName: "OpenMeld",
    eyebrow: "Invitation request",
    heading: input.title,
    body: input.preview,
    actionLabel: "Review request",
    actionUrl: input.inboxUrl,
    footer: "You can approve invitations for this organization.",
  };
}
export function urgentInboxContent(input: InboxEmailProps): ActionEmailProps {
  return {
    brandName: "OpenMeld",
    eyebrow: "Needs your attention",
    heading: input.title,
    body: input.preview,
    actionLabel: "Open Inbox",
    actionUrl: input.inboxUrl,
    footer: "You have urgent Inbox emails turned on.",
  };
}
