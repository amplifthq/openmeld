import { describe, expect, it } from "vitest";
import {
  buildBuiltinAgentSelectionCommand,
  buildBuiltinAgentSelectionExamples,
  getBuiltinAgentSelectionOptionalArguments,
  getBuiltinAgentSelectionRequiredArguments,
  validateBuiltinAgentSelectionInput,
} from "../src/agents/builtin-selection-contract";

describe("builtin agent selection contract", () => {
  it("builds shared repair examples with --all, --agent, and --install", () => {
    expect(buildBuiltinAgentSelectionExamples({ command: "repair" })).toEqual([
      "openmeld agents repair --all",
      "openmeld agents repair --agent <id...>",
      "openmeld agents repair --agent <id> --install <install-id>",
    ]);
    expect(
      buildBuiltinAgentSelectionExamples({
        command: "repair",
        includeViewFlag: true,
      })
    ).toContain("openmeld agents repair --all --view agent");
  });

  it("returns shared overview arguments for builtin agent selectors", () => {
    expect(getBuiltinAgentSelectionRequiredArguments("enable")).toEqual([
      "one selection mode: --all | --agent <id...>",
    ]);
    expect(getBuiltinAgentSelectionOptionalArguments("repair")).toEqual([
      "--install <install-id> with one --agent <id>",
    ]);
    expect(getBuiltinAgentSelectionOptionalArguments("disable")).toEqual([]);
  });

  it("builds exact repair commands from the shared command builder", () => {
    expect(
      buildBuiltinAgentSelectionCommand({
        all: true,
        command: "repair",
      })
    ).toBe("openmeld agents repair --all");
    expect(
      buildBuiltinAgentSelectionCommand({
        agentIds: ["codex"],
        command: "repair",
        includeViewFlag: true,
        installId: "install_nvm",
      })
    ).toBe(
      "openmeld agents repair --agent codex --install install_nvm --view agent"
    );
  });

  it("validates shared selector rules and install restrictions", () => {
    expect(() =>
      validateBuiltinAgentSelectionInput({
        all: true,
        command: "repair",
        explicitIds: ["codex"],
        explicitInstallId: null,
      })
    ).toThrow(
      "agents.config_invalid: use either --all or --agent <id...>, not both"
    );

    expect(() =>
      validateBuiltinAgentSelectionInput({
        all: false,
        command: "repair",
        explicitIds: [],
        explicitInstallId: "install_nvm",
      })
    ).toThrow("agents.repair_invalid: provide --all or --agent <id...>");

    expect(() =>
      validateBuiltinAgentSelectionInput({
        all: false,
        command: "repair",
        explicitIds: ["codex", "claude-code"],
        explicitInstallId: "install_nvm",
      })
    ).toThrow(
      "agents.repair_invalid: use --install only with one --agent <id>"
    );

    expect(() =>
      validateBuiltinAgentSelectionInput({
        all: true,
        command: "repair",
        explicitIds: [],
        explicitInstallId: null,
      })
    ).not.toThrow();
  });
});
