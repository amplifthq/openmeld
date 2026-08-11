import type { SpaceContract } from "@openmeld/schemas/types";
import pc from "picocolors";
import type { Presenter } from "../runtime/presenter";
import { type InfoCardRow, renderInfoCard } from "../ui/info-card";
import { formatPublicationModeForDisplay } from "./contract-set-options";

export function emitSpaceContractHumanOutput(input: {
  presenter: Presenter;
  contract: SpaceContract;
  title?: string;
}): void {
  const { presenter, contract } = input;

  renderInfoCard({
    presenter,
    title: input.title ?? "Space contract:",
    codePrefix: "space.contract.card",
    rows: buildSpaceContractCardRows(contract),
    minContentWidth: 56,
  });
}

function buildSpaceContractCardRows(contract: SpaceContract): InfoCardRow[] {
  return [
    {
      label: "",
      value: pc.bold("Dispatch"),
    },
    {
      label: pc.dim("Mode"),
      value: pc.bold(pc.cyan(contract.dispatchPolicy.mode)),
    },
    { label: "", value: "" },
    {
      label: "",
      value: pc.bold("Publication"),
    },
    {
      label: pc.dim("Mode"),
      value: pc.bold(
        pc.green(formatPublicationModeForDisplay(contract.publicationMode))
      ),
    },
    ...(contract.spaceNote
      ? [
          {
            label: pc.dim("Note"),
            value: contract.spaceNote,
          } satisfies InfoCardRow,
        ]
      : []),
    { label: "", value: "" },
    {
      label: "",
      value: pc.bold("Allowed actions"),
    },
    {
      label: pc.dim("Actions"),
      value:
        contract.allowedActions.length > 0
          ? pc.bold(contract.allowedActions.join(" | "))
          : pc.dim("none"),
    },
    { label: "", value: "" },
    {
      label: "",
      value: pc.bold("Result archive"),
    },
    {
      label: pc.dim("Mode"),
      value: pc.bold(pc.magenta(contract.resultArchivePolicy.mode)),
    },
    { label: "", value: "" },
    {
      label: "",
      value: pc.bold("Briefs + metadata"),
    },
    {
      label: pc.dim("Authority order"),
      value: contract.authorityOrder,
    },
    {
      label: pc.dim("Entry Brief"),
      value: contract.entryBrief,
    },
    {
      label: pc.dim("Dispatch Brief"),
      value: contract.dispatchBrief,
    },
    {
      label: pc.dim("Updated at"),
      value: pc.dim(contract.updatedAt),
    },
    {
      label: pc.dim("Updated by"),
      value: pc.dim(contract.updatedBy),
    },
    {
      label: pc.dim("Version"),
      value: pc.dim(String(contract.version)),
    },
  ];
}
