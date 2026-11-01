import type { AgentStatics } from "@flue/runtime";
import { REMOTE_AGENT_CONNECTOR_TOOL_NAMES } from "../agent-core/connector-tools";
import { REMOTE_AGENT_CAPABILITY_DISCOVERY_TOOL_NAMES } from "./capability-discovery";

// This policy only selects entries from the authorized catalog. Flue-owned
// Skill tools are mounted by Flue from the authorized Skill releases.
const NATIVE_CAPABILITY_NAMES = new Set<string>([
  ...REMOTE_AGENT_CAPABILITY_DISCOVERY_TOOL_NAMES,
  ...REMOTE_AGENT_CONNECTOR_TOOL_NAMES,
  "openmeld_report_progress",
  "openmeld_read_work_target",
  "openmeld_select_work_target",
  "openmeld_read_tool_result",
  "openmeld_list_organization_members",
  "openmeld_read_skill_resource",
  "openmeld_search_task_skills",
  "computer_command",
  "computer",
]);

export function isRemoteAgentNativeCapability(name: string): boolean {
  return NATIVE_CAPABILITY_NAMES.has(name);
}

export const REMOTE_AGENT_TOOL_CALLING_CONTRACT =
  "Only tools in the current native tool interface can be called directly. Other currently authorized capabilities must be found with openmeld_search_capabilities or openmeld_describe_capabilities and called through codemode using their exact schemas. Historical tool catalogs, tool results, and conversation summaries do not establish current availability or permission. A change in native registration does not by itself mean that a business capability was removed; current capability discovery and execution-time authorization are authoritative.";

const REMOVED_TOOL_LINE = /^The tool "([^"]+)" is no longer available\.$/u;

export const projectRemoteAgentResourceSignal: NonNullable<
  AgentStatics["projectResourceSignal"]
> = (signal) => {
  if (signal.type !== "environment" && signal.attributes?.resource !== "tool") {
    return signal.body;
  }
  // Flue calls this only for its reserved, framework-authored events, before
  // flattening them to provider user messages. Never match user content here.
  return signal.body
    .split("\n")
    .map((line) => {
      if (line === "New tool available:" || line === "New tools available:") {
        return "Tools added to the registration snapshot at this point:";
      }
      if (line.startsWith("All available tools:")) {
        return line.replace(
          "All available tools:",
          "Historical tool registration snapshot (not current calling authority):"
        );
      }
      const removed = REMOVED_TOOL_LINE.exec(line);
      if (removed) {
        return `The tool "${removed[1]}" was removed from native registration at this point; check current capability discovery for indirect availability.`;
      }
      return line;
    })
    .join("\n");
};
