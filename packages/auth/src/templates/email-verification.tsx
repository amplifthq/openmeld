import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Section,
  Text,
} from "@react-email/components";
import { OpenMeldEmailLogo } from "./openmeld-email-logo";
import {
  button,
  buttonContainer,
  container,
  content,
  footer,
  h1,
  hr,
  main,
  text,
} from "./styles";

export type VerificationEmailProps = {
  verificationUrl?: string;
  brandName?: string;
  expiresInSeconds?: number;
};

export function VerificationEmail({
  verificationUrl = "http://localhost:3000/verify-email?token=preview-token",
  brandName = "OpenMeld",
  expiresInSeconds = 60 * 60,
}: VerificationEmailProps) {
  const expiresInMinutes = Math.max(1, Math.round(expiresInSeconds / 60));

  return (
    <Html>
      <Head />
      <Body style={main}>
        <Container style={container}>
          <OpenMeldEmailLogo brandName={brandName} />

          <Section style={content}>
            <Heading style={h1}>Verify your email</Heading>

            <Text style={text}>
              Confirm your email address to finish setting up your {brandName}{" "}
              account.
            </Text>

            <Section style={buttonContainer}>
              <Button href={verificationUrl} style={button}>
                Verify email
              </Button>
            </Section>

            <Text style={text}>
              If you didn&apos;t request this email, you can safely ignore it.
            </Text>

            <Hr style={hr} />

            <Text style={footer}>
              This verification link expires in {expiresInMinutes} minutes for
              security.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

VerificationEmail.PreviewProps = {
  verificationUrl: "http://localhost:3000/verify-email?token=preview-token",
  brandName: "OpenMeld",
  expiresInSeconds: 60 * 60,
} satisfies VerificationEmailProps;

export default VerificationEmail;
