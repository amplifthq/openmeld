import { promptSearchMultiselect } from "../../../clients/openmeld-cli/src/ui/search-select";

const result = await promptSearchMultiselect({
  message: "Choose the local agents to connect to OpenMeld on this computer",
  initialSelectedValues: ["claude-code", "codex", "opencode"],
  items: [
    { value: "claude-code", label: "Claude Code" },
    { value: "codex", label: "Codex" },
    { value: "opencode", label: "OpenCode" },
  ],
});

process.stdout.write(`RESULT:${JSON.stringify(result)}\n`);
