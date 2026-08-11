import type { Command } from "commander";
import type { CommandPatternContract } from "../command-contracts/types";

export type AuthLoginRequestRenderContext = {
  includeViewFlag?: boolean;
};

const AUTH_LOGIN_REQUIRED_ARGUMENTS = [
  "one explicit automation path: --ott <token> | --method device",
  "when using --method ott: --ott <token>",
] as const;

const AUTH_LOGIN_OPTIONAL_ARGUMENTS = [
  "--method <device|ott>",
  "--ott <token>",
  "--auth-url <url>",
  "--client-id <id>",
  "--no-open",
] as const;

export const AUTH_LOGIN_REQUEST_PATTERN_CONTRACT: CommandPatternContract<AuthLoginRequestRenderContext> =
  {
    buildCommands: (context) =>
      buildAuthLoginRequestExamples({
        includeViewFlag: context.includeViewFlag,
      }),
    buildHints: () => buildAuthLoginRequestHints(),
    buildOptionalArguments: () => [...AUTH_LOGIN_OPTIONAL_ARGUMENTS],
    buildRequiredArguments: () => [...AUTH_LOGIN_REQUIRED_ARGUMENTS],
  };

export function registerAuthLoginRequestOptions(command: Command): Command {
  return command
    .option(
      "--auth-url <url>",
      "OpenMeld auth URL (CLI > OPENMELD_AUTH_URL > default)"
    )
    .option(
      "--client-id <id>",
      "OAuth device client_id (CLI > OPENMELD_AUTH_CLIENT_ID > built-in default)"
    )
    .option("--method <mode>", "Sign-in method: device|ott")
    .option("--ott <token>", "One-time sign-in token")
    .option("--no-open", "Do not auto-open the verification URL in browser");
}

export function getAuthLoginRequestRequiredArguments(): string[] {
  return [...AUTH_LOGIN_REQUIRED_ARGUMENTS];
}

export function getAuthLoginRequestOptionalArguments(): string[] {
  return [...AUTH_LOGIN_OPTIONAL_ARGUMENTS];
}

export function buildAuthLoginRequestExamples(input?: {
  includeViewFlag?: boolean;
}): string[] {
  return [
    buildAuthLoginRequestCommand({
      command: "login",
      includeViewFlag: input?.includeViewFlag,
      ott: "<token>",
    }),
    buildAuthLoginRequestCommand({
      command: "login",
      includeViewFlag: input?.includeViewFlag,
      method: "device",
      noOpen: true,
    }),
    buildAuthLoginRequestCommand({
      command: "auth status",
      includeViewFlag: input?.includeViewFlag,
    }),
  ];
}

export function buildAuthLoginRequestHints(): string[] {
  return buildAuthLoginRequestExamples();
}

function buildAuthLoginRequestCommand(input: {
  command: "auth status" | "login";
  includeViewFlag?: boolean;
  method?: "device" | "ott";
  noOpen?: boolean;
  ott?: string;
}): string {
  const tokens = ["openmeld", ...input.command.split(" ")];
  if (input.method) {
    tokens.push("--method", input.method);
  }
  if (input.ott) {
    tokens.push("--ott", input.ott);
  }
  if (input.noOpen) {
    tokens.push("--no-open");
  }
  if (input.includeViewFlag) {
    tokens.push("--view", "agent");
  }
  return tokens.join(" ");
}
