import type { SettingsSectionDef } from "./settings-contract";
import type { RailDestination } from "./shell-contract";

/**
 * Mock fixtures for the Phase-0 shell + settings contract — used by the contract
 * tests and as a render harness while both tracks build against the frozen
 * interface. `render` returns plain strings (valid ReactNode) so this stays a
 * `.ts` file with no JSX.
 */

export const RAIL_DESTINATION_FIXTURES: readonly RailDestination[] = [
  { id: "spaces", label: "Spaces", to: "/app/spaces" },
  { id: "settings", label: "Settings", to: "/app/settings" },
];

export const SETTINGS_SECTION_FIXTURES: readonly SettingsSectionDef[] = [
  {
    id: "account",
    title: "Account",
    to: "/app/settings/account",
    requires: ["CLOUD_ACCOUNT"],
    render: () => "Account: identity, sign-in, sessions, CLI tokens",
  },
  {
    id: "computers",
    title: "Computers",
    to: "/app/settings/computers",
    requires: ["CLOUD_ACCOUNT"],
    render: () => "Computers: OpenMeld Service + local agents per machine",
  },
  {
    id: "agents",
    title: "Agents",
    to: "/app/settings/agents",
    requires: ["CLOUD_ACCOUNT"],
    render: () =>
      "Agents: account-level Agent Profiles (name, model, reasoning)",
  },
  {
    id: "service",
    title: "Service & preferences",
    to: "/app/settings/service",
    // Shows wherever there's a local service (CLI-driven Web or Desktop). The
    // "Open OpenMeld Desktop at login" row inside gates on ELECTRON_HOST via ctx.
    requires: ["LOCAL_SERVICE"],
    render: (ctx) =>
      ctx.capabilities.includes("ELECTRON_HOST")
        ? "Service: run-in-background (CLI) + open-at-login (Electron)"
        : "Service: run the OpenMeld Service in the background",
  },
];
