import { listBuiltinAgentsRegistryEntries } from "./agents/registry-source";
import { formatOpenMeldCliLine } from "./runtime/cli-entry-command";

const DEFAULT_AGENT_EXAMPLE_ID = resolveAgentExampleIds(1)[0] ?? "<agent-id>";
export const DEFAULT_AGENT_EXAMPLE_PAIR =
  resolveAgentExampleIds(2).join(" ") || "<agent-a> <agent-b>";
const TOP_LEVEL_HELP_EXAMPLES = [
  "openmeld start",
  "openmeld setup",
  "openmeld auth login",
  "openmeld login",
  "openmeld repair local-state",
  "openmeld uninstall",
  "openmeld reset",
  "openmeld upgrade",
  "openmeld prompt",
  "openmeld prompt onboarding",
  "openmeld prompt commands --raw",
  "openmeld skills",
  "openmeld skills list",
  "openmeld skills show <name-or-id>",
  "openmeld skills load <name-or-id> --view agent",
  "openmeld agents",
  "openmeld agents detect",
  "openmeld setup --profile <agent-profile-id>",
  "openmeld setup --start-session <opaque-token>",
  "openmeld agents enable --all",
  `openmeld agents disable --agent ${DEFAULT_AGENT_EXAMPLE_ID}`,
  "openmeld agents list",
  "openmeld computer list",
  "openmeld computer current",
  'openmeld computer rename "Office MacBook"',
  "openmeld computer rename --clear",
  "openmeld service",
  "openmeld service start",
  "openmeld service status",
  "openmeld service install",
  "openmeld service repair",
  "openmeld service update",
  "openmeld service uninstall",
  "openmeld space",
  "openmeld space join <space-id>",
  "openmeld space watch <space-id>",
  "openmeld space contract <space-id>",
  "openmeld space contract set <space-id> --dispatch-policy mention_only",
  "openmeld space publication set <space-id> collaboration --password <value>",
  "openmeld space status <space-id>",
  "openmeld space updates <space-id> --after-signal <signal-id>",
  "openmeld space result <space-id> --dispatch <dispatch-id>",
  "openmeld space guide <space-id>",
  'openmeld space guide set <space-id> "Keep replies concise."',
  "openmeld space guide clear <space-id>",
  "openmeld space join <space-id> --password <value>",
  "openmeld space password <space-id> --password <new-password>",
  'openmeld space send <space-id> "hello from Mars deck"',
  'echo "hello from file-safe input" | openmeld space send <space-id> --stdin',
  "openmeld space send <space-id> --text-file /tmp/message.txt",
  "openmeld space send <space-id> --file /tmp/launch-brief.pdf",
  "openmeld view",
  "openmeld view agent",
] as const;

const TOP_LEVEL_HELP_GET_OPTIONS_EXAMPLES = [
  "openmeld <command> --help",
  "openmeld space --help",
  "openmeld space join --help",
  "openmeld skills --help",
  "openmeld agents --help",
  "openmeld computer --help",
] as const;

export function buildTopLevelHelpText(): string {
  const exampleLines = TOP_LEVEL_HELP_EXAMPLES.map((line) => {
    return `  ${formatOpenMeldCliLine(line)}`;
  });
  const getOptionsLines = TOP_LEVEL_HELP_GET_OPTIONS_EXAMPLES.map((line) => {
    return `  ${formatOpenMeldCliLine(line)}`;
  });
  return [
    "",
    "Examples:",
    ...exampleLines,
    "",
    "Get command options:",
    ...getOptionsLines,
    "",
  ].join("\n");
}

export function buildCommandHelpExamples(
  title: string,
  examples: string[]
): string {
  const lines = examples.map((line) => `  ${formatOpenMeldCliLine(line)}`);
  return ["", `${title}:`, ...lines, ""].join("\n");
}

function resolveAgentExampleIds(limit: number): string[] {
  const normalizedLimit = Number.isFinite(limit) ? Math.max(1, limit) : 1;
  try {
    const installableBuiltinIds = listBuiltinAgentsRegistryEntries()
      .filter((agent) => agent.service.skillsInstallable === true)
      .map((agent) => agent.id);
    return installableBuiltinIds.slice(0, normalizedLimit);
  } catch {
    return [];
  }
}
