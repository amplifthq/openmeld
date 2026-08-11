export const ROOT_ENTRY_START_COMMAND = "openmeld start";

export const ROOT_ENTRY_COMMANDS = [
  {
    command: "openmeld setup",
    description: "Set up this computer for Space Wake",
  },
  {
    command: "openmeld start",
    description: "Initialize your identity",
  },
  {
    command: "openmeld auth",
    description: "Sign in, sign out, and inspect auth state",
  },
  {
    command: "openmeld profiles",
    description: "Manage OpenMeld profiles",
  },
  {
    command: "openmeld agents",
    description: "Manage OpenMeld agent targets and bindings",
  },
  {
    command: "openmeld computer",
    description: "Name this computer in OpenMeld",
  },
  {
    command: "openmeld view human|agent",
    description: "Switch default view mode",
  },
  {
    command: "openmeld space",
    description: "Create, join, and configure spaces",
  },
  {
    command: "openmeld routines",
    description: "Manage scheduled Center Agent Routines",
  },
  {
    command: "openmeld skills",
    description: "Install or list OpenMeld skills",
  },
  {
    command: "openmeld service",
    description: "Manage OpenMeld background service",
  },
  {
    command: "openmeld whoami",
    description: "Show your current identity",
  },
  {
    command: "openmeld doctor",
    description: "Check local setup and connectivity",
  },
  {
    command: "openmeld upgrade",
    description: "Upgrade OpenMeld CLI when a new version is available",
  },
  {
    command: "openmeld reset",
    description: "Reset local OpenMeld state and reinitialize baseline files",
  },
  {
    command: "openmeld help (-h, --help)",
    description: "Show help for a command",
  },
] as const;
