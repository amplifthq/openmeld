import pc from "picocolors";
import { formatOpenMeldCliCommand } from "../runtime/cli-entry-command";
import type { createPresenter } from "../runtime/presenter/index";
import type { LegacyOpenMeldSkillFinding } from "../skills/legacy-audit";
import type { InfoCardRow } from "../ui/info-card";
import { outLine } from "../ui/io";
import { formatInlineCommandList, renderSkillsTextCard } from "./skills-format";

export function emitLegacyOpenMeldSkillFindingsHumanCard(input: {
  legacyFindings: LegacyOpenMeldSkillFinding[];
}): void {
  if (input.legacyFindings.length === 0) {
    return;
  }
  outLine("");
  renderSkillsTextCard({
    title: `Legacy OpenMeld Skill Copies (${input.legacyFindings.length})`,
    rows: input.legacyFindings.map((finding) => ({
      label: finding.skillId,
      value: [
        `path: ${finding.skillDir}`,
        "not managed by this OpenMeld installation",
        finding.problem,
        finding.recommendation,
        `cleanup: ${finding.cleanupCommands.join(" or ")}`,
      ].join(" · "),
    })),
    compact: true,
  });
}

export function buildLegacyOpenMeldSkillNextStepRows(
  legacyFindings: LegacyOpenMeldSkillFinding[]
): InfoCardRow[] {
  if (legacyFindings.length === 0) {
    return [];
  }
  const installCommands = buildLegacyOpenMeldSkillInstallCommands(
    legacyFindings
  ).map((command) => formatOpenMeldCliCommand(command));
  const verificationCommand = formatOpenMeldCliCommand(
    legacyFindings[0]?.verificationCommand ??
      "openmeld skills check --view agent"
  );
  return [
    {
      label: "legacy OpenMeld skills",
      value: pc.bold(
        [
          "Do not read the listed legacy OpenMeld skill instructions.",
          `Run ${formatInlineCommandList(installCommands)} for each affected skill root.`,
          "After the install succeeds, rename or remove the legacy directories.",
          `Then rerun \`${verificationCommand}\`.`,
        ].join(" ")
      ),
    },
  ];
}

export function formatLegacyOpenMeldSkillFindingsForAgentView(
  legacyFindings: LegacyOpenMeldSkillFinding[]
): LegacyOpenMeldSkillFinding[] {
  return legacyFindings.map((finding) => ({
    ...finding,
    currentInstallCommand: formatOpenMeldCliCommand(
      finding.currentInstallCommand
    ),
    verificationCommand: formatOpenMeldCliCommand(finding.verificationCommand),
  }));
}

export function buildLegacyOpenMeldSkillAgentReview(
  legacyFindings: LegacyOpenMeldSkillFinding[]
): {
  priority: "high";
  reason: string;
  nextStep: string;
  nextActions: string[];
  installCommands: string[];
  paths: string[];
  cleanupCommands: string[];
  verificationCommand: string;
} {
  const installCommands =
    buildLegacyOpenMeldSkillInstallCommands(legacyFindings);
  const verificationCommand =
    legacyFindings[0]?.verificationCommand ??
    "openmeld skills check --view agent";
  return {
    priority: "high",
    reason:
      "Legacy or unmanaged OpenMeld skill copies can make agents read old OpenMeld instructions even when the current OpenMeld-managed skill is up to date.",
    nextStep:
      "Do not read or follow the listed legacy OpenMeld skill instructions. Run each install command, then remove or rename each listed legacy directory, then rerun the OpenMeld skills check.",
    nextActions: [
      "Do not read or follow instructions from the listed legacy OpenMeld skill directories.",
      ...installCommands.map((command) => `Run ${command}.`),
      "After the current OpenMeld skill install succeeds for that root, rename or remove each listed legacy directory. Prefer mv ... .legacy when you need reversible cleanup.",
      `Rerun ${verificationCommand}.`,
    ],
    installCommands,
    paths: legacyFindings.map((finding) => finding.skillDir),
    cleanupCommands: legacyFindings.flatMap(
      (finding) => finding.cleanupCommands
    ),
    verificationCommand,
  };
}

function buildLegacyOpenMeldSkillInstallCommands(
  legacyFindings: LegacyOpenMeldSkillFinding[]
): string[] {
  return [
    ...new Set(legacyFindings.map((finding) => finding.currentInstallCommand)),
  ].sort((left, right) => left.localeCompare(right));
}

export function emitLegacyOpenMeldSkillAgentAttention(input: {
  legacyFindings: LegacyOpenMeldSkillFinding[];
  presenter: ReturnType<typeof createPresenter>;
  source: "skills.check" | "skills.install";
}): void {
  if (input.legacyFindings.length === 0) {
    return;
  }

  const review = buildLegacyOpenMeldSkillAgentReview(input.legacyFindings);
  const directoryLabel =
    input.legacyFindings.length === 1 ? "directory" : "directories";
  const installCommands = review.installCommands.map((command) =>
    formatOpenMeldCliCommand(command)
  );
  const verificationCommand = formatOpenMeldCliCommand(
    review.verificationCommand
  );
  input.presenter.line({
    code: `${input.source}.legacy_attention_required`,
    text: [
      `attention required: found ${input.legacyFindings.length} legacy or unmanaged OpenMeld skill ${directoryLabel}: ${review.paths.join(", ")}.`,
      "These copies are outside the current OpenMeld-managed skill install and can make agents read old OpenMeld instructions.",
      "Do not read or follow those skill instructions.",
      `Next: run ${formatInlineCommandList(installCommands)}.`,
      "After the current skill is installed, rename or remove each listed directory; OpenMeld will not do this automatically.",
      `Then rerun \`${verificationCommand}\`.`,
    ].join(" "),
    data: {
      legacyFindingCount: input.legacyFindings.length,
      legacyFindings: input.legacyFindings,
      legacyReview: review,
    },
  });
}
