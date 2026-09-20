import { ActionEmail } from "./_components/action-email";

export type { MagicLinkEmailProps } from "./_components/content";

import {
  type MagicLinkEmailProps,
  magicLinkContent,
} from "./_components/content";

export function MagicLinkEmail(props: MagicLinkEmailProps) {
  return <ActionEmail {...magicLinkContent(props)} />;
}

MagicLinkEmail.PreviewProps = {
  magicLinkUrl: "https://openmeld.example/magic-link?token=preview",
  brandName: "OpenMeld",
  expiresInSeconds: 300,
} satisfies MagicLinkEmailProps;

export default MagicLinkEmail;
