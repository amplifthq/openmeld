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

export type MagicLinkEmailProps = {
  magicLinkUrl?: string;
  brandName?: string;
  expiresInSeconds?: number;
};

export function MagicLinkEmail({
  magicLinkUrl = "http://localhost:3000/magic-link?token=preview-token",
  brandName = "OpenMeld",
  expiresInSeconds = 60 * 5,
}: MagicLinkEmailProps) {
  const expiresInMinutes = Math.max(1, Math.round(expiresInSeconds / 60));

  return (
    <Html>
      <Head />
      <Body style={main}>
        <Container style={container}>
          <OpenMeldEmailLogo brandName={brandName} />

          <Section style={content}>
            <Heading style={h1}>Sign in with magic link</Heading>

            <Text style={text}>
              A sign-in link was requested for your {brandName} account.
            </Text>

            <Section style={buttonContainer}>
              <Button href={magicLinkUrl} style={button}>
                Continue to {brandName}
              </Button>
            </Section>

            <Text style={text}>
              If you didn't request this email, you can safely ignore it.
            </Text>

            <Hr style={hr} />

            <Text style={footer}>
              This link expires in {expiresInMinutes} minutes for security.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

MagicLinkEmail.PreviewProps = {
  magicLinkUrl: "http://localhost:3000/magic-link?token=preview-token",
  brandName: "OpenMeld",
  expiresInSeconds: 60 * 5,
} satisfies MagicLinkEmailProps;

export default MagicLinkEmail;
