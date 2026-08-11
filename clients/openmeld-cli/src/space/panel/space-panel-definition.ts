export type SpacePanelKind = "help" | "space" | "members" | "logs";

export type SpacePanelMode = "readonly" | "searchable_list";

export type SpacePanelLayout = "centered_modal";

export type SpacePanelContentAlign = "left" | "centered_block";

export type SpacePanelSurfaceVariant = "dark" | "light";

export type PanelInstruction = {
  id: string;
  keys: readonly string[];
  label: string;
};

export type PanelInstructionPreset = "readonly-close" | "searchable-list-close";

export type SpacePanelDefinition = {
  contentAlign: SpacePanelContentAlign;
  kind: SpacePanelKind;
  layout: SpacePanelLayout;
  mode: SpacePanelMode;
  surfaceVariant: SpacePanelSurfaceVariant;
  title: string;
  instructionPreset: PanelInstructionPreset;
};

const SPACE_PANEL_DEFINITIONS = [
  {
    contentAlign: "left",
    kind: "help",
    title: "Space Commands",
    mode: "readonly",
    layout: "centered_modal",
    surfaceVariant: "dark",
    instructionPreset: "readonly-close",
  },
  {
    contentAlign: "left",
    kind: "space",
    title: "🛰️ Space Info",
    mode: "readonly",
    layout: "centered_modal",
    surfaceVariant: "dark",
    instructionPreset: "readonly-close",
  },
  {
    contentAlign: "left",
    kind: "members",
    title: "👥 Space Members",
    mode: "searchable_list",
    layout: "centered_modal",
    surfaceVariant: "dark",
    instructionPreset: "searchable-list-close",
  },
  {
    contentAlign: "left",
    kind: "logs",
    title: "🗒️ Space Logs",
    mode: "searchable_list",
    layout: "centered_modal",
    surfaceVariant: "dark",
    instructionPreset: "searchable-list-close",
  },
] as const satisfies readonly SpacePanelDefinition[];

const SPACE_PANEL_DEFINITION_BY_KIND = new Map(
  SPACE_PANEL_DEFINITIONS.map(
    (definition) => [definition.kind, definition] as const
  )
);

const PANEL_INSTRUCTION_PRESETS = {
  "readonly-close": [
    {
      id: "close",
      keys: ["Esc"],
      label: "close",
    },
  ],
  "searchable-list-close": [
    {
      id: "close",
      keys: ["Esc"],
      label: "close",
    },
  ],
} as const satisfies Record<
  PanelInstructionPreset,
  readonly PanelInstruction[]
>;

export function getSpacePanelDefinition(
  kind: SpacePanelKind
): SpacePanelDefinition {
  const definition = SPACE_PANEL_DEFINITION_BY_KIND.get(kind);
  if (!definition) {
    throw new Error(`Unknown space panel kind: ${kind}`);
  }
  return definition;
}

export function listSpacePanelInstructions(
  preset: PanelInstructionPreset
): readonly PanelInstruction[] {
  return PANEL_INSTRUCTION_PRESETS[preset];
}

export function formatPanelInstructionsLine(
  instructions: readonly PanelInstruction[]
): string {
  if (instructions.length === 0) {
    return "";
  }

  if (
    instructions.length === 1 &&
    instructions[0]?.id === "close" &&
    matchesInstructionKeys(instructions[0].keys, ["Esc"])
  ) {
    return "Press Esc to close.";
  }

  return instructions
    .map((instruction) => `${instruction.keys.join("/")}: ${instruction.label}`)
    .join("  ·  ");
}

function matchesInstructionKeys(
  actual: readonly string[],
  expected: readonly string[]
): boolean {
  if (actual.length !== expected.length) {
    return false;
  }
  return actual.every((value, index) => value === expected[index]);
}
