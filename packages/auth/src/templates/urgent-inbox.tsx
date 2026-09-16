import { ActionEmail } from "./_components/action-email";
import {
  type InboxEmailProps,
  urgentInboxContent,
} from "./_components/content";

export function UrgentInboxEmail(props: InboxEmailProps) {
  return <ActionEmail {...urgentInboxContent(props)} />;
}

UrgentInboxEmail.PreviewProps = {
  title: "Review the launch plan",
  preview: "The launch plan is ready. Review it in OpenMeld to continue.",
  inboxUrl: "https://openmeld.example/o/acme/inbox?item=preview",
} satisfies InboxEmailProps;

export default UrgentInboxEmail;
