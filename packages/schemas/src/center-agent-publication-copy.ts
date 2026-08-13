import type { OpenMeldNavigationTarget } from "./navigation-action";

export const CENTER_AGENT_ACCOUNT_CONNECTION_REQUIRED_PUBLIC_COPY =
  "I need your OpenMeld account before I can continue. OpenMeld will send you a private message with a “Connect my account and continue” button. After you connect, I’ll continue this request automatically.";

export function resolveCenterAgentCompletedCallbackMessage(input: {
  navigationTarget?: OpenMeldNavigationTarget;
  text: string;
}): string {
  return input.navigationTarget?.kind === "message_channel_identity_link" ||
    input.navigationTarget?.kind === "slack_identity_link"
    ? CENTER_AGENT_ACCOUNT_CONNECTION_REQUIRED_PUBLIC_COPY
    : input.text;
}
