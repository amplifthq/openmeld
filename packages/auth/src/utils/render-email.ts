import { render } from "@react-email/components";
import { createElement } from "react";
import {
  ActionEmail,
  type ActionEmailProps,
} from "../templates/_components/action-email";

export async function renderActionEmail(content: ActionEmailProps) {
  return {
    html: await render(createElement(ActionEmail, content)),
    // Preserve exact action URLs in the accessible plain-text alternative.
    text: [
      content.brandName,
      content.eyebrow,
      content.heading,
      content.body,
      `${content.actionLabel}: ${content.actionUrl}`,
      content.note,
      content.footer,
    ]
      .filter(Boolean)
      .join("\n\n"),
  };
}
