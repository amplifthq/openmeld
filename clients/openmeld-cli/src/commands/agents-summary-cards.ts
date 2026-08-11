import pc from "picocolors";
import type { AgentTargetState } from "../agents/registry";
import type { createPresenter } from "../runtime/presenter/index";
import type { InfoCardRow } from "../ui/info-card";
import {
  buildReadyAgentCardRow,
  buildTurnedOffAgentCardRow,
  renderAgentsInfoCard,
} from "./agents-cards";
import { emitHumanSectionDescription } from "./agents-descriptions";
import { formatAgentsToneText, formatStatusTextForHuman } from "./agents-text";

export type EnableSummary = {
  requested: string[];
  registered: string[];
  reenabled: string[];
  skipped: Array<{ agentId: string; reason: string }>;
  errors: Array<{
    agentId: string;
    code: string;
    humanActionRequired?: boolean;
    installChoices?: AgentTargetState["installChoices"];
    nextSteps?: string[];
    reason: string;
    summary?: string;
  }>;
  allMode: boolean;
};

export type RepairSummary = {
  requested: string[];
  repaired: string[];
  skipped: Array<{ agentId: string; reason: string }>;
  errors: Array<{
    agentId: string;
    code: string;
    humanActionRequired?: boolean;
    installChoices?: AgentTargetState["installChoices"];
    nextSteps?: string[];
    reason: string;
    summary?: string;
  }>;
  allMode: boolean;
};

export type DisableSummary = {
  requested: string[];
  disabled: string[];
  skipped: Array<{ agentId: string; reason: string }>;
  errors: Array<{ agentId: string; code: string; reason: string }>;
  allMode: boolean;
};

const AGENTS_ENABLE_RESULT_DESCRIPTION =
  "These agents can now reply when someone mentions them in a Space from this computer.";
const AGENTS_DISABLE_RESULT_DESCRIPTION =
  "These agents will stop replying to new mentions in Spaces.";

export function emitEnableSummaryCardsForHuman(input: {
  presenter: ReturnType<typeof createPresenter>;
  summary: EnableSummary;
  targetStateById: Map<string, AgentTargetState>;
}): void {
  emitHumanSectionDescription(input.presenter, {
    codePrefix: "agents.enable",
    description: AGENTS_ENABLE_RESULT_DESCRIPTION,
  });
  renderAgentsInfoCard({
    presenter: input.presenter,
    codePrefix: "agents.enable.summary.card",
    title: "Agents Turned On",
    rows: buildEnableSummaryRows(input.summary),
    minContentWidth: 38,
  });

  const detailCards = buildEnableDetailCards(
    input.summary,
    input.targetStateById
  );
  for (const card of detailCards) {
    input.presenter.line({
      code: `agents.enable.${card.codeSuffix}.spacer`,
      text: "",
    });
    renderAgentsInfoCard({
      presenter: input.presenter,
      codePrefix: `agents.enable.${card.codeSuffix}.card`,
      title: card.title,
      rows: card.rows,
      minContentWidth: 30,
    });
  }
}

function buildEnableSummaryRows(summary: EnableSummary): InfoCardRow[] {
  const rows: InfoCardRow[] = [
    {
      label: "Status",
      value: buildEnableSummaryStatus(summary),
    },
  ];

  if (summary.registered.length > 0) {
    rows.push({
      label: "On now",
      value: String(summary.registered.length),
    });
  }
  if (summary.reenabled.length > 0) {
    rows.push({
      label: "Back on",
      value: String(summary.reenabled.length),
    });
  }
  if (summary.skipped.length > 0) {
    rows.push({
      label: "Already on",
      value: String(summary.skipped.length),
    });
  }
  if (summary.errors.length > 0) {
    rows.push({
      label: "Needs attention",
      value: String(summary.errors.length),
    });
  }

  return rows;
}

function buildEnableSummaryStatus(summary: EnableSummary): string {
  const readyCount = summary.registered.length + summary.reenabled.length;
  const reviewCount = summary.skipped.length + summary.errors.length;

  if (readyCount > 0 && reviewCount === 0) {
    if (summary.allMode) {
      return readyCount === 1
        ? `1 detected agent is ${formatAgentsToneText("success", "available now")}`
        : `All detected available agents are ${formatAgentsToneText("success", "on now")}`;
    }
    return readyCount === 1
      ? `1 selected agent is ${formatAgentsToneText("success", "available now")}`
      : `${readyCount} selected agents are ${formatAgentsToneText("success", "available now")}`;
  }

  if (readyCount > 0) {
    return readyCount === 1
      ? `1 agent is ${formatAgentsToneText("success", "available now")} ${pc.dim("· review the rest below")}`
      : `${readyCount} agents are ${formatAgentsToneText("success", "available now")} ${pc.dim("· review the rest below")}`;
  }

  if (summary.skipped.length > 0 && summary.errors.length === 0) {
    return formatAgentsToneText("info", "Already on");
  }

  return formatAgentsToneText("warning", "OpenMeld could not turn these on");
}

function buildEnableDetailCards(
  summary: EnableSummary,
  targetStateById: Map<string, AgentTargetState>
): Array<{
  codeSuffix: string;
  title: string;
  rows: InfoCardRow[];
}> {
  const cards: Array<{
    codeSuffix: string;
    title: string;
    rows: InfoCardRow[];
  }> = [];

  if (summary.registered.length > 0) {
    cards.push({
      codeSuffix: "enabled_now",
      title: `Turned On Now (${summary.registered.length})`,
      rows: summary.registered.map((agentId) =>
        buildReadyAgentCardRow(
          agentId,
          resolveEnableResultDisplayName(agentId, targetStateById)
        )
      ),
    });
  }

  if (summary.reenabled.length > 0) {
    cards.push({
      codeSuffix: "reenabled",
      title: `Turned Back On (${summary.reenabled.length})`,
      rows: summary.reenabled.map((agentId) =>
        buildReadyAgentCardRow(
          agentId,
          resolveEnableResultDisplayName(agentId, targetStateById)
        )
      ),
    });
  }

  if (summary.skipped.length > 0) {
    cards.push({
      codeSuffix: "already_enabled",
      title: `Already On (${summary.skipped.length})`,
      rows: summary.skipped.map((item) => ({
        label: resolveEnableResultDisplayName(item.agentId, targetStateById),
        value: formatEnableSkippedReasonForHuman(item.reason),
      })),
    });
  }

  if (summary.errors.length > 0) {
    cards.push({
      codeSuffix: "needs_attention",
      title: `Needs Attention (${summary.errors.length})`,
      rows: summary.errors.map((item) => ({
        label: resolveEnableResultDisplayName(item.agentId, targetStateById),
        value: formatEnableErrorReasonForHuman(item),
      })),
    });
  }

  return cards;
}

function resolveEnableResultDisplayName(
  agentId: string,
  targetStateById: Map<string, AgentTargetState>
): string {
  return targetStateById.get(agentId)?.displayName ?? agentId;
}

function formatEnableSkippedReasonForHuman(reason: string): string {
  if (reason === "already_enabled") {
    return "Already on in OpenMeld";
  }
  return formatStatusTextForHuman(reason);
}

function formatEnableErrorReasonForHuman(input: {
  code: string;
  installChoices?: AgentTargetState["installChoices"];
  nextSteps?: string[];
  reason: string;
  summary?: string;
}): string {
  if (
    input.code === "controller.launch.choice_required" &&
    input.installChoices &&
    input.installChoices.length > 0
  ) {
    const choiceSummary = input.installChoices
      .map(
        (installChoice) =>
          `${installChoice.installId} (${installChoice.label} · ${installChoice.detail})`
      )
      .join("; ");
    const nextStepSummary = (input.nextSteps ?? []).join(" or ");
    return [
      input.summary ??
        "Needs your choice on this Mac before OpenMeld can continue.",
      `Choices: ${choiceSummary}`,
      nextStepSummary ? `Next: ${nextStepSummary}` : null,
    ]
      .filter((line) => Boolean(line))
      .join(" ");
  }
  if (input.reason === "not found") {
    return "Not found on this computer";
  }
  if (input.reason === "will be supported soon") {
    return "Found on this computer, but OpenMeld support is coming soon";
  }
  if (input.reason === "custom target is not runnable yet") {
    return "Custom targets cannot be enabled yet";
  }
  if (input.reason === "not selectable in current runtime") {
    return "Not available in this runtime";
  }
  if (input.reason === "unknown built-in target id") {
    return "Not in the built-in support list";
  }
  if (input.reason === "needs repair") {
    return "Needs repair on this computer before OpenMeld can start it";
  }
  if (input.reason === "needs your choice") {
    return "Needs your choice on this Mac before OpenMeld can use it";
  }
  if (input.code === "agents.config_write_failed") {
    return "OpenMeld could not save this change";
  }
  return formatStatusTextForHuman(input.reason);
}

export function buildRepairSummaryRows(summary: RepairSummary): InfoCardRow[] {
  const rows: InfoCardRow[] = [
    {
      label: "Status",
      value: buildRepairSummaryStatus(summary),
    },
  ];

  if (summary.repaired.length > 0) {
    rows.push({
      label: "Repaired",
      value: String(summary.repaired.length),
    });
  }
  if (summary.skipped.length > 0) {
    rows.push({
      label: "Already available",
      value: String(summary.skipped.length),
    });
  }
  if (summary.errors.length > 0) {
    rows.push({
      label: "Needs attention",
      value: String(summary.errors.length),
    });
  }

  return rows;
}

function buildRepairSummaryStatus(summary: RepairSummary): string {
  if (summary.repaired.length > 0 && summary.errors.length === 0) {
    if (summary.skipped.length === 0) {
      return summary.repaired.length === 1
        ? `1 agent is ${formatAgentsToneText("success", "available now")}`
        : `${String(summary.repaired.length)} agents are ${formatAgentsToneText("success", "available now")}`;
    }
    return `${String(summary.repaired.length)} agents are ${formatAgentsToneText("success", "available now")} ${pc.dim("· review the rest below")}`;
  }
  if (summary.skipped.length > 0 && summary.errors.length === 0) {
    return formatAgentsToneText("info", "Already available");
  }
  return formatAgentsToneText(
    "warning",
    "OpenMeld could not repair all selected agents"
  );
}

export function buildRepairDetailCards(
  summary: RepairSummary,
  targetStateById: Map<string, AgentTargetState>
): Array<{
  codeSuffix: string;
  title: string;
  rows: InfoCardRow[];
}> {
  const cards: Array<{
    codeSuffix: string;
    title: string;
    rows: InfoCardRow[];
  }> = [];

  if (summary.repaired.length > 0) {
    cards.push({
      codeSuffix: "repaired",
      title: `Available Now (${summary.repaired.length})`,
      rows: summary.repaired.map((agentId) =>
        buildReadyAgentCardRow(
          agentId,
          resolveEnableResultDisplayName(agentId, targetStateById)
        )
      ),
    });
  }

  if (summary.skipped.length > 0) {
    cards.push({
      codeSuffix: "already_ready",
      title: `Already Available (${summary.skipped.length})`,
      rows: summary.skipped.map((item) => ({
        label: resolveEnableResultDisplayName(item.agentId, targetStateById),
        value:
          item.reason === "already_ready"
            ? "Already available on this computer"
            : formatStatusTextForHuman(item.reason),
      })),
    });
  }

  if (summary.errors.length > 0) {
    cards.push({
      codeSuffix: "needs_attention",
      title: `Needs Attention (${summary.errors.length})`,
      rows: summary.errors.map((item) => ({
        label: resolveEnableResultDisplayName(item.agentId, targetStateById),
        value: formatRepairErrorReasonForHuman(item),
      })),
    });
  }

  return cards;
}

function formatRepairErrorReasonForHuman(input: {
  code: string;
  installChoices?: AgentTargetState["installChoices"];
  nextSteps?: string[];
  reason: string;
  summary?: string;
}): string {
  if (input.reason === "agent is not registered") {
    return "This agent is not connected in OpenMeld yet";
  }
  if (input.reason === "custom target is not runnable yet") {
    return "Custom targets cannot be repaired yet";
  }
  if (input.reason === "unknown built-in target id") {
    return "Not in the built-in support list";
  }
  return formatEnableErrorReasonForHuman(input);
}

export function emitDisableSummaryCardsForHuman(input: {
  presenter: ReturnType<typeof createPresenter>;
  summary: DisableSummary;
  displayNameById: Map<string, string>;
}): void {
  emitHumanSectionDescription(input.presenter, {
    codePrefix: "agents.disable",
    description: AGENTS_DISABLE_RESULT_DESCRIPTION,
  });
  renderAgentsInfoCard({
    presenter: input.presenter,
    codePrefix: "agents.disable.summary.card",
    title: "Agents Turned Off",
    rows: buildDisableSummaryRows(input.summary),
    minContentWidth: 38,
  });

  const detailCards = buildDisableDetailCards(
    input.summary,
    input.displayNameById
  );
  for (const card of detailCards) {
    input.presenter.line({
      code: `agents.disable.${card.codeSuffix}.spacer`,
      text: "",
    });
    renderAgentsInfoCard({
      presenter: input.presenter,
      codePrefix: `agents.disable.${card.codeSuffix}.card`,
      title: card.title,
      rows: card.rows,
      minContentWidth: 30,
    });
  }
}

function buildDisableSummaryRows(summary: DisableSummary): InfoCardRow[] {
  const rows: InfoCardRow[] = [
    {
      label: "Status",
      value: buildDisableSummaryStatus(summary),
    },
  ];

  if (summary.disabled.length > 0) {
    rows.push({
      label: "Off now",
      value: String(summary.disabled.length),
    });
  }
  if (summary.skipped.length > 0) {
    rows.push({
      label: "Already off",
      value: String(summary.skipped.length),
    });
  }
  if (summary.errors.length > 0) {
    rows.push({
      label: "Needs attention",
      value: String(summary.errors.length),
    });
  }

  return rows;
}

function buildDisableSummaryStatus(summary: DisableSummary): string {
  if (summary.disabled.length > 0 && summary.skipped.length === 0) {
    return summary.disabled.length === 1
      ? `1 agent ${formatAgentsToneText("warning", "turned off")}`
      : `${String(summary.disabled.length)} agents ${formatAgentsToneText("warning", "turned off")}`;
  }

  if (summary.disabled.length > 0) {
    return summary.disabled.length === 1
      ? `1 agent ${formatAgentsToneText("warning", "turned off")} ${pc.dim("· review the rest below")}`
      : `${String(summary.disabled.length)} agents ${formatAgentsToneText("warning", "turned off")} ${pc.dim("· review the rest below")}`;
  }

  if (summary.skipped.length > 0 && summary.errors.length === 0) {
    return formatAgentsToneText("info", "Already off");
  }

  return formatAgentsToneText("warning", "OpenMeld could not turn these off");
}

function buildDisableDetailCards(
  summary: DisableSummary,
  displayNameById: Map<string, string>
): Array<{
  codeSuffix: string;
  title: string;
  rows: InfoCardRow[];
}> {
  const cards: Array<{
    codeSuffix: string;
    title: string;
    rows: InfoCardRow[];
  }> = [];

  if (summary.disabled.length > 0) {
    cards.push({
      codeSuffix: "turned_off",
      title: `Turned Off (${summary.disabled.length})`,
      rows: summary.disabled.map((agentId) =>
        buildTurnedOffAgentCardRow(
          agentId,
          displayNameById.get(agentId) ?? agentId
        )
      ),
    });
  }

  if (summary.skipped.length > 0) {
    cards.push({
      codeSuffix: "already_off",
      title: `Already Off (${summary.skipped.length})`,
      rows: summary.skipped.map((item) => ({
        label: displayNameById.get(item.agentId) ?? item.agentId,
        value: formatDisableSkippedReasonForHuman(item.reason),
      })),
    });
  }

  if (summary.errors.length > 0) {
    cards.push({
      codeSuffix: "needs_attention",
      title: `Needs Attention (${summary.errors.length})`,
      rows: summary.errors.map((item) => ({
        label: displayNameById.get(item.agentId) ?? item.agentId,
        value: formatDisableErrorReasonForHuman(item),
      })),
    });
  }

  return cards;
}

function formatDisableSkippedReasonForHuman(reason: string): string {
  if (reason === "already_disabled") {
    return "Already off in OpenMeld";
  }
  return formatStatusTextForHuman(reason);
}

function formatDisableErrorReasonForHuman(input: {
  code: string;
  reason: string;
}): string {
  if (input.reason === "agent is not registered") {
    return "Not currently connected to OpenMeld";
  }
  if (input.code === "agents.config_write_failed") {
    return "OpenMeld could not save this change";
  }
  return formatStatusTextForHuman(input.reason);
}
