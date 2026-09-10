import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import type { CSSProperties } from "react";

export type ActionEmailProps = {
  brandName: string;
  heading: string;
  body: string;
  actionLabel: string;
  actionUrl: string;
  note?: string;
  footer: string;
  eyebrow?: string;
};

// Email-safe equivalents of Fluid's neutral palette, 8px controls and flat
// hierarchy. Keep inline styles: inbox clients cannot consume app CSS or motion.
const fontFamily =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif';
const muted: CSSProperties = {
  color: "#686864",
  fontSize: "13px",
  lineHeight: "20px",
  margin: "0",
};

export function ActionEmail(props: ActionEmailProps) {
  return (
    <Html lang="en">
      <Head />
      <Preview>
        {props.heading} — {props.body}
      </Preview>
      <Body
        style={{
          backgroundColor: "#f6f6f4",
          color: "#1c1c1a",
          fontFamily,
          margin: "0",
          padding: "32px 12px",
        }}
      >
        <Container style={{ maxWidth: "520px", margin: "0 auto" }}>
          <Text
            style={{
              color: "#555550",
              fontSize: "14px",
              fontWeight: 600,
              margin: "0 0 20px 4px",
            }}
          >
            {props.brandName}
          </Text>
          <Section
            style={{
              backgroundColor: "#ffffff",
              border: "1px solid #e5e5e1",
              borderRadius: "8px",
              padding: "28px 24px",
            }}
          >
            {props.eyebrow && (
              <Text style={{ ...muted, margin: "0 0 12px", color: "#92600a" }}>
                {props.eyebrow}
              </Text>
            )}
            <Heading
              as="h1"
              style={{
                fontSize: "24px",
                fontWeight: 600,
                letterSpacing: "-0.5px",
                lineHeight: "32px",
                margin: "0 0 12px",
                overflowWrap: "anywhere",
              }}
            >
              {props.heading}
            </Heading>
            <Text
              style={{
                color: "#555550",
                fontSize: "15px",
                lineHeight: "24px",
                margin: "0 0 24px",
                overflowWrap: "anywhere",
              }}
            >
              {props.body}
            </Text>
            <Button
              href={props.actionUrl}
              style={{
                backgroundColor: "#242422",
                borderRadius: "8px",
                color: "#ffffff",
                fontSize: "14px",
                fontWeight: 500,
                lineHeight: "20px",
                padding: "12px 18px",
                textDecoration: "none",
              }}
            >
              {props.actionLabel}
            </Button>
            {props.note && (
              <Text style={{ ...muted, margin: "18px 0 0" }}>{props.note}</Text>
            )}
            <Hr
              style={{
                border: "0",
                borderTop: "1px solid #e5e5e1",
                margin: "24px 0 16px",
              }}
            />
            <Text style={muted}>{props.footer}</Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}
