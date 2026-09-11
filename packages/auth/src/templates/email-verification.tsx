import { ActionEmail } from "./_components/action-email";

export type { VerificationEmailProps } from "./_components/content";

import {
  type VerificationEmailProps,
  verificationContent,
} from "./_components/content";

export function VerificationEmail(props: VerificationEmailProps) {
  return <ActionEmail {...verificationContent(props)} />;
}

VerificationEmail.PreviewProps = {
  verificationUrl: "https://openmeld.example/verify-email?token=preview",
  brandName: "OpenMeld",
  expiresInSeconds: 3600,
} satisfies VerificationEmailProps;

export default VerificationEmail;
