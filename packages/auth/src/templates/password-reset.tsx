import { ActionEmail } from "./_components/action-email";
import {
  type PasswordResetEmailProps,
  passwordResetContent,
} from "./_components/content";

export type { PasswordResetEmailProps } from "./_components/content";

export function PasswordResetEmail(props: PasswordResetEmailProps) {
  return <ActionEmail {...passwordResetContent(props)} />;
}

PasswordResetEmail.PreviewProps = {
  resetPasswordUrl: "https://app.openmeld.example/reset-password?token=preview",
  brandName: "OpenMeld",
  expiresInSeconds: 3600,
} satisfies PasswordResetEmailProps;

export default PasswordResetEmail;
