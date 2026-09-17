import { ActionEmail } from "./_components/action-email";
import {
  type OrganizationInvitationEmailProps,
  organizationInvitationContent,
} from "./_components/content";

export function OrganizationInvitationEmail(
  props: OrganizationInvitationEmailProps
) {
  return <ActionEmail {...organizationInvitationContent(props)} />;
}

OrganizationInvitationEmail.PreviewProps = {
  invitationUrl:
    "https://openmeld.example/accept-invitation?invitationId=preview",
  brandName: "OpenMeld",
  organizationName: "Acme",
  inviterName: "Jordan",
  role: "member",
  expiresAt: new Date("2026-10-01T17:00:00Z"),
} satisfies OrganizationInvitationEmailProps;

export default OrganizationInvitationEmail;
