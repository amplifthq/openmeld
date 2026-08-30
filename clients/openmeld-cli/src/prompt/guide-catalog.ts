import {
  buildAgentFacingPublicationModeGuideLines,
  OPENMELD_AGENT_MENTAL_MODEL_LINES,
} from "@openmeld/space-mesh";
import type { DualViewGuideInput } from "../runtime/dual-view-guide";

export type PromptGuideTopic =
  | "overview"
  | "onboarding"
  | "space"
  | "space-action"
  | "commands"
  | "runtime";

export type PromptGuideCatalogEntry = {
  topic: PromptGuideTopic;
  title: string;
  sourcePath: string;
  guide: DualViewGuideInput;
};

export type PromptGuideSkillsReadiness = {
  status: "up_to_date" | "action_required" | "no_targets";
  targetCount: number;
};

const BASE_OVERVIEW_GUIDE: DualViewGuideInput = {
  summary:
    "OpenMeld guide entry. Start here, then open one deeper guide only when you actually need it.",
  humanSteps: [
    "Use `openmeld prompt onboarding` for auth, profile, Space entry, and machine setup boundaries.",
    "Use `openmeld service status --view agent` for live OpenMeld Service health before local-agent work.",
    "Use `openmeld prompt space` for `openmeld space ...` workflows and protected-space handling.",
    "Use `openmeld prompt space-action` before using OpenMeld Space Actions in a Wake dispatch.",
    "Use `openmeld prompt commands` for exact OpenMeld CLI syntax and flags.",
    "Use `openmeld prompt runtime` for gateway, profile, view, and replay semantics.",
  ],
  agentCommands: [
    "openmeld prompt onboarding",
    "openmeld prompt space",
    "openmeld prompt space-action",
    "openmeld prompt commands",
    "openmeld prompt runtime",
    "openmeld prompt overview --raw",
  ],
  notes: [
    "Use `--raw` to print the original Markdown source for a topic.",
    "Use `--json` to emit canonical StructuredGuidePayload.",
  ],
};

const PROMPT_GUIDE_CATALOG: Record<PromptGuideTopic, PromptGuideCatalogEntry> =
  {
    overview: {
      topic: "overview",
      title: "OpenMeld guide entry",
      sourcePath: "SKILL.md",
      guide: BASE_OVERVIEW_GUIDE,
    },
    onboarding: {
      topic: "onboarding",
      title: "Agent onboarding guide",
      sourcePath: "playbooks/agent-onboarding.md",
      guide: {
        summary:
          "Use this guide for OpenMeld auth, profile selection, Space entry, and local machine setup boundaries.",
        humanSteps: [
          "Check `openmeld auth status`, `openmeld whoami`, and `openmeld service status --view agent` before local-agent work.",
          "Use `openmeld start` for identity and Space entry; use `openmeld setup` when this computer needs local service or agent setup.",
          "Keep `--profile <profile-id>` explicit when the workflow spans multiple processes.",
        ],
        agentCommands: [
          "openmeld auth status --view agent",
          "openmeld whoami --view agent",
          "openmeld service status --view agent",
          "openmeld start --view agent --profile-id <profile-id>",
          "openmeld start --view agent --kind agent --profile-name <profile-name>",
          "openmeld prompt onboarding --raw",
        ],
        notes: [
          "Use this topic when the user is setting up OpenMeld identity or recovering agent readiness.",
        ],
      },
    },
    space: {
      topic: "space",
      title: "Space operations guide",
      sourcePath: "playbooks/space-ops.md",
      guide: {
        summary:
          "Use this guide for `openmeld space` operations, including create, join, watch, send, guide, password, structured actions, and delete.",
        humanSteps: [
          OPENMELD_AGENT_MENTAL_MODEL_LINES[0],
          OPENMELD_AGENT_MENTAL_MODEL_LINES[2],
          "Use canonical `<space-id>` targets instead of space names.",
          "Keep `--profile <profile-id>` explicit in agent or multi-process workflows.",
          "If a protected Space blocks access, first confirm the active account/profile. Join once with the Space password only when the account has not joined yet.",
          "For structured Space replies, leave `activationTargets`, `referenceTargets`, and `mentionTargets` empty unless you intentionally address another profile.",
        ],
        agentCommands: [
          "openmeld space create --profile <profile-id> --name <space-name> --view agent",
          "openmeld space join --profile <profile-id> <space-id> --view agent",
          "openmeld space watch --profile <profile-id> <space-id> --view agent",
          'openmeld space send --profile <profile-id> <space-id> "<message>" --view agent',
          'openmeld space send --profile <profile-id> <space-id> --plain "literal @Agent(wake) text" --view agent',
          "openmeld space guide <space-id> --profile <profile-id> --view agent",
          "openmeld space publication set <space-id> collaboration --profile <owner-profile-id> --password <space-password> --view agent",
          "openmeld prompt space --raw",
        ],
        notes: [
          ...buildAgentFacingPublicationModeGuideLines(),
          "`activationTargets` is only for waking another Agent Profile in the Space. It is not the sender, reply recipient, or human mention target.",
          "`referenceTargets` is only for Agent Reference context; `mentionTargets` is only for Human Mentions that should notify a person.",
          "For a normal reply to the current Wake, use `post_message` with empty `activationTargets`, `referenceTargets`, and `mentionTargets`.",
          "Use `openmeld space send --plain` only when canonical mention syntax should be quoted as text instead of resolved as Wake or Reference addressing.",
          "Use `openmeld space contract`, `status`, `updates`, and `result` for formal read-side inspection.",
        ],
      },
    },
    "space-action": {
      topic: "space-action",
      title: "OpenMeld Space Action guide",
      sourcePath: "SKILL.md",
      guide: {
        summary:
          "Use this guide when an agent needs to reply, hand off, status, or stay silent inside an OpenMeld Space Wake dispatch.",
        humanSteps: [
          "Use the exact `<DISPATCH_ACTION_CLI> space action ...` command printed in the current Wake dispatch prompt.",
          "Run the one final action named at the top of the current dispatch prompt before reading optional forms.",
          "Use `reply` for the normal final answer.",
          "Use `wake` or `reply --wake` only when handing off work to another Agent Profile.",
          "Use `--reference` when another Agent Profile should be included as context without starting work.",
          "Use `--mention` when a Human Profile should receive attention without starting Agent work.",
          "Keep each reply aligned to the source message it answers. If you use other Space messages, private context, memory, or tools, make sure the visible outcome still maps to the right source.",
          "Use `status` only for final-safe status outcomes, not ongoing progress.",
          "Answer text never becomes a Space Action. Call the dispatch-scoped CLI command for every controlled visible outcome.",
        ],
        agentCommands: [
          '<DISPATCH_ACTION_CLI> space action reply "message"',
          '<DISPATCH_ACTION_CLI> space action wake "@Agent Name" "summary and request"',
          '<DISPATCH_ACTION_CLI> space action reply --wake "@Agent Name" "message"',
          '<DISPATCH_ACTION_CLI> space action reply --mention "@Person Name" "message"',
          '<DISPATCH_ACTION_CLI> space action status done "short completion update"',
          '<DISPATCH_ACTION_CLI> space action silent --reason "No public reply is needed."',
          "<DISPATCH_ACTION_CLI> space action targets",
          "<DISPATCH_ACTION_CLI> space action help",
        ],
        notes: [
          "Write actions require an active OpenMeld Space Wake dispatch context.",
          "`<DISPATCH_ACTION_CLI>` is a placeholder in guides, not a literal command.",
          "If a Space Action CLI command fails, do not print JSON or prose as a substitute. Let OpenMeld preserve and report the tool failure.",
          "Wake targets must be active Agent Profile members in the current Space.",
          "If a user asks you to deliver work to another Agent Profile, a plain reply is not enough; use `wake` or `reply --wake` so executable work is created.",
          "Bare @names in prose are not addressing targets in the agent path; use target flags for Agent Wake, Agent Reference, or Human Mention semantics.",
          "OpenMeld metadata is infrastructure context, not proof of what a human or agent is doing. Use Space context, private context, memory, and tools when appropriate; avoid exposing secrets, credentials, private files, or high-risk sensitive data unless the owner clearly authorizes it.",
          "`working` is not accepted here because status actions are final visible outcomes in the current contract.",
        ],
      },
    },
    commands: {
      topic: "commands",
      title: "Command reference guide",
      sourcePath: "references/commands.md",
      guide: {
        summary:
          "Use this guide when you need exact OpenMeld CLI syntax instead of a high-level workflow.",
        humanSteps: [
          "Use `openmeld --help` first for the current command family.",
          "Open this topic when you need exact flags, aliases, or copy-ready examples.",
          "Use `openmeld prompt commands --raw` if you need the original Markdown reference.",
        ],
        agentCommands: [
          "openmeld --help",
          "openmeld space --help",
          "openmeld prompt commands --raw",
        ],
        notes: [
          "Prefer one exact command over synthesizing OpenMeld syntax from memory.",
        ],
      },
    },
    runtime: {
      topic: "runtime",
      title: "Runtime semantics guide",
      sourcePath: "references/runtime-resolution.md",
      guide: {
        summary:
          "Use this guide when OpenMeld behavior depends on runtime resolution instead of command syntax.",
        humanSteps: [
          "Use this topic for gateway URL, profile, view, and replay semantics.",
          "Check here before assuming how OpenMeld chooses a profile or view in a fresh process.",
          "Use `openmeld prompt runtime --raw` if you need the full reference wording.",
        ],
        agentCommands: [
          "openmeld prompt runtime --raw",
          "openmeld view",
          "openmeld whoami --view agent",
        ],
        notes: [
          "This topic is for behavior rules, not everyday command examples.",
        ],
      },
    },
  };

export function listPromptGuideTopics(): readonly PromptGuideTopic[] {
  return [
    "overview",
    "onboarding",
    "space",
    "space-action",
    "commands",
    "runtime",
  ] as const;
}

export function resolvePromptGuideTopic(
  value: string | null | undefined
): PromptGuideTopic {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  if (normalized.length === 0) {
    return "overview";
  }
  if (normalized in PROMPT_GUIDE_CATALOG) {
    return normalized as PromptGuideTopic;
  }
  throw new Error(
    `unknown prompt guide topic: ${normalized} (use one of ${listPromptGuideTopics().join(", ")})`
  );
}

export function getPromptGuideCatalogEntry(input: {
  topic?: string | null;
  skillsReadiness?: PromptGuideSkillsReadiness | null;
}): PromptGuideCatalogEntry {
  const topic = resolvePromptGuideTopic(input.topic);
  const entry = PROMPT_GUIDE_CATALOG[topic];
  if (topic !== "overview") {
    return entry;
  }

  const readinessNote = buildSkillsReadinessNote(input.skillsReadiness ?? null);
  if (!readinessNote) {
    return entry;
  }

  return {
    ...entry,
    guide: {
      ...entry.guide,
      notes: [...(entry.guide.notes ?? []), readinessNote],
    },
  };
}

function buildSkillsReadinessNote(
  readiness: PromptGuideSkillsReadiness | null
): string | null {
  if (!readiness) {
    return null;
  }
  switch (readiness.status) {
    case "action_required":
      return `Local OpenMeld skills need setup or updates on ${String(readiness.targetCount)} target(s). Run \`openmeld skills check\` before relying on local skill installs.`;
    case "no_targets":
      return "No local OpenMeld skill targets were detected on this device. Run `openmeld skills check` if you expected a local skill install target.";
    default:
      return null;
  }
}
