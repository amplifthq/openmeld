import {
  type InboxEmailProps,
  invitationReviewContent,
  type MagicLinkEmailProps,
  magicLinkContent,
  type OrganizationInvitationEmailProps,
  organizationInvitationContent,
  type SpaceInvitationEmailProps,
  spaceInvitationContent,
  urgentInboxContent,
  type VerificationEmailProps,
  verificationContent,
} from "../templates/_components/content";
import { renderActionEmail } from "./render-email";

export type VerificationEmailHtmlInput = VerificationEmailProps;
export type MagicLinkEmailHtmlInput = MagicLinkEmailProps;
export type OrganizationInvitationEmailInput = OrganizationInvitationEmailProps;
export type BuiltEmailContent = { html: string; text: string };

// Production and React Email previews use the same content and layout.
export function buildVerificationEmailContent(
  input: VerificationEmailHtmlInput
) {
  return renderActionEmail(verificationContent(input));
}
export function buildMagicLinkEmailContent(input: MagicLinkEmailHtmlInput) {
  return renderActionEmail(magicLinkContent(input));
}
export function buildOrganizationInvitationEmailContent(
  input: OrganizationInvitationEmailInput
) {
  return renderActionEmail(organizationInvitationContent(input));
}
export function buildSpaceInvitationEmailContent(
  input: SpaceInvitationEmailProps
) {
  return renderActionEmail(spaceInvitationContent(input));
}
export function buildInboxEmailContent(
  input: InboxEmailProps & { purpose?: "invitation_review" }
) {
  return renderActionEmail(
    input.purpose === "invitation_review"
      ? invitationReviewContent(input)
      : urgentInboxContent(input)
  );
}
