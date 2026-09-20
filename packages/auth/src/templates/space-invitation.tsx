import { ActionEmail } from "./_components/action-email";
import {
  type SpaceInvitationEmailProps,
  spaceInvitationContent,
} from "./_components/content";

export function SpaceInvitationEmail(props: SpaceInvitationEmailProps) {
  return <ActionEmail {...spaceInvitationContent(props)} />;
}

SpaceInvitationEmail.PreviewProps = {
  invitationUrl:
    "https://openmeld.example/accept-space-invitation?token=preview",
  brandName: "OpenMeld",
  organizationName: "Acme",
  inviterName: "Jordan",
  spaceName: "Product design",
  expiresAt: new Date("2026-10-01T17:00:00Z"),
} satisfies SpaceInvitationEmailProps;

export default SpaceInvitationEmail;
