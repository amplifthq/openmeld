import { ActionEmail } from "./_components/action-email";
import {
  type InboxEmailProps,
  invitationReviewContent,
} from "./_components/content";

export function InvitationReviewEmail(props: InboxEmailProps) {
  return <ActionEmail {...invitationReviewContent(props)} />;
}

InvitationReviewEmail.PreviewProps = {
  title: "Review invitation: alex@example.com",
  preview:
    "alex@example.com is waiting to join your organization. Any owner or admin can approve this request.",
  inboxUrl:
    "https://openmeld.example/o/acme/settings/invitations?requestId=preview",
} satisfies InboxEmailProps;

export default InvitationReviewEmail;
