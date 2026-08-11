import { parseLeadingCommandTokensFromArgv } from "./view-argv";

type RetiredCliCommand = {
  readonly tokens: readonly string[];
  readonly message: string;
};

const RETIRED_CLI_COMMANDS: readonly RetiredCliCommand[] = [
  {
    tokens: ["space", "conversation"],
    message:
      "unknown command: space conversation. Agent controller conversations are profile settings now. Use `openmeld profiles update <profile-id> --agent-controller-conversation-id <id>` to update an Agent Profile, or `openmeld profiles show <profile-id> --json` to inspect it.",
  },
  {
    tokens: ["spaces", "conversation"],
    message:
      "unknown command: space conversation. Agent controller conversations are profile settings now. Use `openmeld profiles update <profile-id> --agent-controller-conversation-id <id>` to update an Agent Profile, or `openmeld profiles show <profile-id> --json` to inspect it.",
  },
];

export function resolveRetiredCliCommandMessage(
  argv: readonly string[]
): string | null {
  const maxTokens = RETIRED_CLI_COMMANDS.reduce(
    (max, command) => Math.max(max, command.tokens.length),
    0
  );
  const leadingTokens = parseLeadingCommandTokensFromArgv([...argv], maxTokens);
  const retiredCommand = RETIRED_CLI_COMMANDS.find((command) =>
    command.tokens.every((token, index) => leadingTokens[index] === token)
  );

  return retiredCommand?.message ?? null;
}
