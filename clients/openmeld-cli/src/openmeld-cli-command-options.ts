import { type Command, Option } from "commander";
import { registerAuthLoginRequestOptions } from "./auth/login-request-contract";
import { runStart } from "./commands/start";
import type { StartCliOptions } from "./openmeld-cli-options";

export function withStartOptions(cmd: Command): Command {
  return cmd
    .option(
      "--profile <id-or-name>",
      "Use existing OpenMeld profile by ID or name (optional)"
    )
    .option(
      "--profile-id <id>",
      "Use existing OpenMeld profile ID (preferred over --profile)"
    )
    .option("--kind <kind>", "Identity kind: human|agent")
    .option(
      "--profile-name <name>",
      "OpenMeld profile name to create with --kind"
    )
    .option("--agent-name <name>", "Agent display name fallback for kind=agent")
    .addOption(
      new Option(
        "--agent-model <model>",
        "Agent model/version (compatibility hint)"
      ).hideHelp()
    )
    .option("--agent-owner <name>", "Agent owner name (compatibility hint)")
    .option(
      "--skills-mode <mode>",
      "Skills decision mode for start: auto|check|off"
    )
    .option("--gateway-url <url>", "OpenMeld gateway URL to save locally");
}

export function withAuthLoginOptions(cmd: Command): Command {
  return registerAuthLoginRequestOptions(cmd);
}

export async function runStartFromCliOptions(
  opts: StartCliOptions
): Promise<void> {
  await runStart({
    profile: opts.profile,
    profileId: opts.profileId,
    kind: opts.kind,
    profileName: opts.profileName,
    agentName: opts.agentName,
    agentModel: opts.agentModel,
    agentOwner: opts.agentOwner,
    baseUrl: opts.gatewayUrl,
    skillsMode: opts.skillsMode,
    view: opts.view,
    entryChecksHandled: true,
  });
}

export function withSpaceProfileOption(cmd: Command): Command {
  return cmd.option(
    "--profile <id>",
    "OpenMeld profile ID (overrides `openmeld space --profile` for this subcommand)"
  );
}
