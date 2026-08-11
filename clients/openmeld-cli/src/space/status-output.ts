import type { GetSpaceStatusResponse } from "@openmeld/schemas/types";
import pc from "picocolors";
import type { Presenter } from "../runtime/presenter";
import { type InfoCardRow, renderInfoCard } from "../ui/info-card";
import { sanitizeTerminalDisplayText } from "../ui/terminal-safe-text";
import { formatPublicationModeForDisplay } from "./contract-set-options";

export function emitSpaceStatusHumanOutput(input: {
  presenter: Presenter;
  status: GetSpaceStatusResponse;
}): void {
  renderInfoCard({
    presenter: input.presenter,
    title: "Space status:",
    codePrefix: "space.status.overview",
    rows: buildSpaceStatusOverviewRows(input.status),
    minContentWidth: 56,
  });

  renderInfoCard({
    presenter: input.presenter,
    title: "Collaboration summary:",
    codePrefix: "space.status.members",
    rows: buildSpaceStatusMembersRows(input.status),
    minContentWidth: 56,
  });

  if (!input.status.latestVisibleUpdate) {
    return;
  }

  renderInfoCard({
    presenter: input.presenter,
    title: "Latest public activity:",
    codePrefix: "space.status.latest",
    rows: buildSpaceStatusLatestUpdateRows(input.status.latestVisibleUpdate),
    minContentWidth: 56,
  });
}

export function emitSpaceStatusAgentOutput(input: {
  presenter: Presenter;
  status: GetSpaceStatusResponse;
}): void {
  const spaceLabel = input.status.name?.trim() || input.status.spaceId;
  input.presenter.line({
    code: "space.status",
    text: `space status: ${spaceLabel}, members=${input.status.members.totalCount}, agents=${input.status.members.agentCount}`,
    data: {
      spaceId: input.status.spaceId,
      spaceName: input.status.name ?? null,
      members: {
        totalCount: input.status.members.totalCount,
        humanCount: input.status.members.humanCount,
        agentCount: input.status.members.agentCount,
        liveHumanCount: input.status.members.liveHumanCount,
        liveAgentCount: input.status.members.liveAgentCount,
      },
      latestVisibleUpdate: input.status.latestVisibleUpdate
        ? {
            signalId: input.status.latestVisibleUpdate.signalId,
            signalType: input.status.latestVisibleUpdate.signalType,
            actorProfileId: input.status.latestVisibleUpdate.actorProfileId,
            actorName: input.status.latestVisibleUpdate.actorName ?? null,
            previewText: sanitizeTerminalDisplayText(
              input.status.latestVisibleUpdate.previewText,
              "single-line"
            ),
          }
        : null,
    },
  });
}

function buildSpaceStatusOverviewRows(
  status: GetSpaceStatusResponse
): InfoCardRow[] {
  return [
    {
      label: pc.dim("Space"),
      value: pc.bold(pc.cyan(status.name?.trim() || status.spaceId)),
    },
    ...(status.name?.trim()
      ? [
          {
            label: pc.dim("Space ID"),
            value: pc.dim(status.spaceId),
          } satisfies InfoCardRow,
        ]
      : []),
    {
      label: pc.dim("Security"),
      value: status.passwordProtected
        ? pc.bold(pc.yellow("protected"))
        : pc.bold(pc.green("open")),
    },
    {
      label: pc.dim("Dispatch mode"),
      value: pc.bold(pc.cyan(status.dispatchPolicy.mode)),
    },
    {
      label: pc.dim("Publication mode"),
      value: pc.bold(
        pc.green(formatPublicationModeForDisplay(status.publicationMode))
      ),
    },
    {
      label: pc.dim("Allowed actions"),
      value: pc.bold(status.allowedActions.join(" | ")),
    },
    {
      label: pc.dim("Result archive"),
      value: pc.bold(pc.magenta(status.resultArchivePolicy.mode)),
    },
    {
      label: pc.dim("Entry Brief"),
      value: status.entryBrief,
    },
    {
      label: pc.dim("Dispatch Brief"),
      value: status.dispatchBrief,
    },
  ];
}

function buildSpaceStatusMembersRows(
  status: GetSpaceStatusResponse
): InfoCardRow[] {
  return [
    {
      label: pc.dim("Total members"),
      value: pc.bold(pc.cyan(String(status.members.totalCount))),
    },
    {
      label: pc.dim("Humans"),
      value: pc.bold(String(status.members.humanCount)),
    },
    {
      label: pc.dim("Agents"),
      value: pc.bold(String(status.members.agentCount)),
    },
    {
      label: pc.dim("Connected humans"),
      value: pc.bold(String(status.members.liveHumanCount)),
    },
    {
      label: pc.dim("Connected agents"),
      value: pc.bold(String(status.members.liveAgentCount)),
    },
  ];
}

function buildSpaceStatusLatestUpdateRows(
  latestVisibleUpdate: NonNullable<
    GetSpaceStatusResponse["latestVisibleUpdate"]
  >
): InfoCardRow[] {
  return [
    {
      label: pc.dim("Actor"),
      value: pc.bold(
        pc.cyan(
          latestVisibleUpdate.actorName?.trim() ||
            latestVisibleUpdate.actorProfileId
        )
      ),
    },
    ...(latestVisibleUpdate.actorName?.trim()
      ? [
          {
            label: pc.dim("Actor profile ID"),
            value: pc.dim(latestVisibleUpdate.actorProfileId),
          } satisfies InfoCardRow,
        ]
      : []),
    {
      label: pc.dim("Type"),
      value: formatLatestVisibleUpdateType(latestVisibleUpdate.signalType),
    },
    {
      label: pc.dim("Created at"),
      value: pc.dim(latestVisibleUpdate.createdAt),
    },
    {
      label: pc.dim("Preview"),
      value: pc.bold(
        sanitizeTerminalDisplayText(
          latestVisibleUpdate.previewText,
          "single-line"
        )
      ),
    },
  ];
}

function formatLatestVisibleUpdateType(
  signalType: NonNullable<
    GetSpaceStatusResponse["latestVisibleUpdate"]
  >["signalType"]
): string {
  switch (signalType) {
    case "signal.text":
      return pc.bold(pc.green("text"));
    case "signal.status":
      return pc.bold(pc.cyan("status"));
    case "signal.system_notice":
      return pc.bold(pc.yellow("system_notice"));
    default:
      return pc.bold(signalType);
  }
}
