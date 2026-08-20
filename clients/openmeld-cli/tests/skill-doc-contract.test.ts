import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildAgentFacingMentalModelLines,
  buildAgentFacingPublicationModeGuideLines,
} from "@openmeld/space-mesh";
import { describe, expect, it } from "vitest";

const TEST_DIR = fileURLToPath(new URL(".", import.meta.url));
const CLI_ROOT = join(TEST_DIR, "..");

const SKILL_DIR = join(CLI_ROOT, "skills", "openmeld-cli");
const SKILL_FILE_PATH = join(SKILL_DIR, "SKILL.md");
const AGENT_ONBOARDING_PATH = join(
  SKILL_DIR,
  "playbooks",
  "agent-onboarding.md"
);
const SPACE_OPS_PATH = join(SKILL_DIR, "playbooks", "space-ops.md");
const COMMANDS_REFERENCE_PATH = join(SKILL_DIR, "references", "commands.md");
const RUNTIME_REFERENCE_PATH = join(
  SKILL_DIR,
  "references",
  "runtime-resolution.md"
);
const OPENMELD_SOURCE_PATH = join(CLI_ROOT, "src", "openmeld.ts");
const RAW_SPACE_ACTION_COMMAND_PATTERN = /^openmeld space action /m;

const REQUIRED_SKILL_LINKS = [
  "playbooks/agent-onboarding.md",
  "playbooks/space-ops.md",
  "references/commands.md",
  "references/runtime-resolution.md",
] as const;

describe("openmeld-cli skill docs contract", () => {
  it("contains required layered skill files", async () => {
    for (const filePath of [
      SKILL_FILE_PATH,
      AGENT_ONBOARDING_PATH,
      SPACE_OPS_PATH,
      COMMANDS_REFERENCE_PATH,
      RUNTIME_REFERENCE_PATH,
    ]) {
      // eslint-disable-next-line no-await-in-loop
      const exists = await fileExists(filePath);
      expect(exists).toBe(true);
    }
  });

  it("includes progressive disclosure links in SKILL.md", async () => {
    const raw = await readFile(SKILL_FILE_PATH, "utf8");

    for (const linkPath of REQUIRED_SKILL_LINKS) {
      expect(raw).toContain(linkPath);
    }
  });

  it("documents Organization collaboration and live Wake controls for agents", async () => {
    const skillRaw = await readFile(SKILL_FILE_PATH, "utf8");
    const spaceOpsRaw = await readFile(SPACE_OPS_PATH, "utf8");
    const commandsReferenceRaw = await readFile(
      COMMANDS_REFERENCE_PATH,
      "utf8"
    );

    for (const raw of [skillRaw, commandsReferenceRaw]) {
      for (const command of [
        "openmeld org directory",
        "openmeld org computers",
        "openmeld org invite-link get",
        "openmeld org invite-link create",
        "openmeld org invite-link revoke",
      ]) {
        expect(raw).toContain(command);
      }
    }

    for (const raw of [skillRaw, spaceOpsRaw, commandsReferenceRaw]) {
      for (const command of [
        "openmeld space wake-progress",
        "openmeld space wake-stop",
        "openmeld space list --organization",
        "openmeld space join --self-serve",
      ]) {
        expect(raw).toContain(command);
      }
    }
  });

  it("teaches Local Agents to consult the canonical Center Agent Chat", async () => {
    const docs = [
      await readFile(SKILL_FILE_PATH, "utf8"),
      await readFile(COMMANDS_REFERENCE_PATH, "utf8"),
    ].map(normalizeMarkdownWhitespace);

    for (const raw of docs) {
      expect(raw).toContain("openmeld center-agent ask");
      expect(raw).toContain("automatically detects");
      expect(raw).toContain("--via");
      expect(raw).toContain("--session");
      expect(raw).toContain("same Center Agent Chat");
      expect(raw).toContain("attribution and correlation only");
      expect(raw).toContain("does not cancel the request");
    }
  });

  it("teaches a truthful invisible context-load and Task handoff workflow", async () => {
    const docs = [
      await readFile(SKILL_FILE_PATH, "utf8"),
      await readFile(COMMANDS_REFERENCE_PATH, "utf8"),
    ].map(normalizeMarkdownWhitespace);

    for (const raw of docs) {
      expect(raw).toContain("nextAction.command");
      expect(raw).toContain("center-agent context receipt");
      expect(raw).toContain("working context");
      expect(raw).toContain("does not mean the model used every message");
      expect(raw).toContain("taskReferences");
      expect(raw).toContain("do not create duplicate work");
      expect(raw).toContain("quick answer or immediate safe action");
      expect(raw).toContain("durable, asynchronous, parallel, or recoverable");
    }
  });

  it("keeps the first-screen mental model aligned with the shared agent copy", async () => {
    const raw = normalizeMarkdownWhitespace(
      await readFile(SKILL_FILE_PATH, "utf8")
    );

    for (const line of buildAgentFacingMentalModelLines()) {
      expect(raw).toContain(line);
    }
  });

  it("keeps publication-mode guidance aligned across agent-facing skill docs", async () => {
    const docs = [
      await readFile(SKILL_FILE_PATH, "utf8"),
      await readFile(SPACE_OPS_PATH, "utf8"),
      await readFile(COMMANDS_REFERENCE_PATH, "utf8"),
    ].map(normalizeMarkdownWhitespace);

    for (const raw of docs) {
      for (const line of buildAgentFacingPublicationModeGuideLines()) {
        expect(raw).toContain(line);
      }
    }
  });

  it("documents structured Space action target semantics", async () => {
    const skillRaw = await readFile(SKILL_FILE_PATH, "utf8");
    const spaceOpsRaw = await readFile(SPACE_OPS_PATH, "utf8");
    const commandsReferenceRaw = await readFile(
      COMMANDS_REFERENCE_PATH,
      "utf8"
    );

    for (const raw of [skillRaw, spaceOpsRaw, commandsReferenceRaw]) {
      expect(raw).toContain(
        "`activationTargets` is only for waking another Agent Profile"
      );
      expect(raw).toContain("`referenceTargets`");
      expect(raw).not.toContain("`ccTargets`");
    }
  });

  it("documents source alignment, delivery intent, and metadata disclosure boundaries", async () => {
    const docs = [
      await readFile(SKILL_FILE_PATH, "utf8"),
      await readFile(SPACE_OPS_PATH, "utf8"),
      await readFile(COMMANDS_REFERENCE_PATH, "utf8"),
    ].map(normalizeMarkdownWhitespace);

    for (const raw of docs) {
      expect(raw).toContain("source");
      expect(raw).toContain("deliver work to another Agent Profile");
      expect(raw).toContain("not executable delivery");
      expect(raw).toContain("OpenMeld metadata is infrastructure context");
      expect(raw).toContain(
        "not proof of what a human or agent is currently doing"
      );
      expect(raw.toLowerCase()).toContain("avoid exposing secrets");
    }
  });

  it("documents current local session binding recipes", async () => {
    const docs = [
      await readFile(SKILL_FILE_PATH, "utf8"),
      await readFile(SPACE_OPS_PATH, "utf8"),
      await readFile(COMMANDS_REFERENCE_PATH, "utf8"),
    ].map(normalizeMarkdownWhitespace);

    for (const raw of docs) {
      expect(raw).toContain("current local agent session");
      expect(raw).toContain("CODEX_THREAD_ID");
      expect(raw).toContain("CLAUDE_CODE_SESSION_ID");
      expect(raw).toContain("Project folder");
      expect(raw).toContain("builtin:codex");
      expect(raw).toContain("builtin:claude-code");
      expect(raw).toContain("Claude Code resume");
    }
  });

  it("documents Cursor ACP setup, model, and permission semantics", async () => {
    const docs = [
      await readFile(SKILL_FILE_PATH, "utf8"),
      await readFile(AGENT_ONBOARDING_PATH, "utf8"),
      await readFile(COMMANDS_REFERENCE_PATH, "utf8"),
    ].map(normalizeMarkdownWhitespace);

    for (const raw of docs) {
      expect(raw).toContain("builtin:cursor");
      expect(raw).toContain("cursor-agent acp");
      expect(raw).toContain("cursor-agent login");
      expect(raw).toContain(
        "Cursor CLI sign-in is separate from Cursor IDE sign-in"
      );
      expect(raw).toContain("default|plan|ask|auto-review|run-everything");
      expect(raw).toContain("exact model ID");
      expect(raw).toContain("no independent reasoning");
    }
  });

  it("uses dispatch-scoped placeholders for Space Action command examples", async () => {
    const docs = [
      await readFile(SKILL_FILE_PATH, "utf8"),
      await readFile(SPACE_OPS_PATH, "utf8"),
      await readFile(COMMANDS_REFERENCE_PATH, "utf8"),
    ];

    for (const raw of docs) {
      expect(raw).toContain("<DISPATCH_ACTION_CLI> space action reply");
      expect(raw).not.toMatch(RAW_SPACE_ACTION_COMMAND_PATTERN);
    }
  });

  it("documents Organization Skill reads and exact-release loading", async () => {
    const commandsReferenceRaw = await readFile(
      COMMANDS_REFERENCE_PATH,
      "utf8"
    );

    expect(commandsReferenceRaw).toContain(
      "openmeld skills show <name-or-id> --view agent"
    );
    expect(commandsReferenceRaw).toContain(
      "openmeld skills load <name-or-id> --view agent"
    );
    expect(commandsReferenceRaw).toContain("Use `openmeld setup`");
  });

  it("documents live service health checkpoints for agents", async () => {
    const docs = [
      await readFile(SKILL_FILE_PATH, "utf8"),
      await readFile(AGENT_ONBOARDING_PATH, "utf8"),
      await readFile(SPACE_OPS_PATH, "utf8"),
      await readFile(COMMANDS_REFERENCE_PATH, "utf8"),
    ];

    for (const raw of docs) {
      expect(raw).toContain("openmeld service status --view agent");
      expect(raw).toContain(
        "openmeld service status --profile <agent-profile-id> --view agent"
      );
    }

    for (const raw of [docs[0], docs[1], docs[2]]) {
      expect(raw).toContain("Update OpenMeld Service");
      expect(raw).toContain("Update OpenMeld skills");
      expect(raw).toContain("openmeld setup --view agent");
      expect(raw).not.toContain("openmeld service update --view agent");
    }
  });

  it("documents all top-level program commands from openmeld.ts", async () => {
    const openMeldSourceRaw = await readFile(OPENMELD_SOURCE_PATH, "utf8");
    const commandReferenceRaw = await readFile(COMMANDS_REFERENCE_PATH, "utf8");

    const sourceTopLevelCommands =
      extractTopLevelProgramCommands(openMeldSourceRaw);
    const documentedTopLevelCommands =
      extractDocumentedTopLevelCommands(commandReferenceRaw);

    expect(sourceTopLevelCommands.size).toBeGreaterThan(0);

    const missingCommands = [...sourceTopLevelCommands].filter(
      (command) => !documentedTopLevelCommands.has(command)
    );

    expect(missingCommands).toEqual([]);
  });
});

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function normalizeMarkdownWhitespace(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function extractTopLevelProgramCommands(source: string): Set<string> {
  // Hidden commands (`.command("name", { hidden: true })`) still exist and
  // must stay documented in the command reference for support flows.
  const commandRegex = /program\s*\.command\("([^"]+)"(?:,\s*\{[^}]*\})?\)/g;
  const chainedCommandRegex =
    /(?:^|\n)(?:const\s+\w+\s*=\s*)?program[\s\S]*?\.command\("([^"]+)"(?:,\s*\{[^}]*\})?\)/g;
  const commands = new Set<string>();

  for (const match of source.matchAll(commandRegex)) {
    const command = match[1]?.trim();
    if (command && command.length > 0) {
      commands.add(command);
    }
  }

  for (const match of source.matchAll(chainedCommandRegex)) {
    const command = match[1]?.trim();
    if (command && command.length > 0) {
      commands.add(command);
    }
  }

  return commands;
}

function extractDocumentedTopLevelCommands(source: string): Set<string> {
  const headingRegex = /^### `openmeld ([^`]+)`$/gm;
  const commands = new Set<string>();

  for (const match of source.matchAll(headingRegex)) {
    const command = match[1]?.trim();
    if (command && command.length > 0) {
      commands.add(command);
    }
  }

  return commands;
}
