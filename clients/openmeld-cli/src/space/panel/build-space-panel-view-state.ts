import type { PanelViewState } from "../view/space-session-view-state";
import {
  getSpacePanelDefinition,
  listSpacePanelInstructions,
  type SpacePanelKind,
} from "./space-panel-definition";

export function buildSpacePanelViewState(input: {
  bodyByKind: Record<SpacePanelKind, PanelViewState["body"]["blocks"]>;
  headerMetaTextByKind?: Partial<Record<SpacePanelKind, string | null>>;
  kind: SpacePanelKind | "none";
  searchableListByKind?: Partial<
    Record<SpacePanelKind, NonNullable<PanelViewState["searchableList"]>>
  >;
}): PanelViewState | null {
  if (input.kind === "none") {
    return null;
  }

  const definition = getSpacePanelDefinition(input.kind);
  return {
    body: {
      blocks: input.bodyByKind[input.kind],
    },
    contentAlign: definition.contentAlign,
    headerMetaText: input.headerMetaTextByKind?.[input.kind] ?? null,
    kind: definition.kind,
    instructions: listSpacePanelInstructions(definition.instructionPreset),
    layout: definition.layout,
    mode: definition.mode,
    searchableList: input.searchableListByKind?.[input.kind] ?? null,
    surfaceVariant: definition.surfaceVariant,
    title: definition.title,
    visible: true,
  };
}
