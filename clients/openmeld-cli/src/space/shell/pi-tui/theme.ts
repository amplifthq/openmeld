import type { EditorTheme, SelectListTheme } from "@mariozechner/pi-tui";
import pc from "picocolors";
import type { SpacePanelSurfaceVariant } from "../../panel/space-panel-definition";

type RgbTriplet = readonly [number, number, number];
const ANSI_RESET_FOREGROUND = "\x1B[39m";
const ANSI_RESET_BACKGROUND = "\x1B[49m";

const selectListTheme: SelectListTheme = {
  selectedPrefix: (text) => pc.cyan(text),
  selectedText: (text) => pc.cyan(text),
  description: (text) => pc.dim(text),
  scrollInfo: (text) => pc.dim(text),
  noMatch: (text) => pc.dim(text),
};

export const spacePiTuiEditorTheme: EditorTheme = {
  borderColor: (text) => pc.dim(text),
  selectList: selectListTheme,
};

const panelSurfaceThemes = {
  dark: {
    // Keep panel border and surface on the same background tone so the
    // full-width top/bottom rows do not read as a thicker frame than the sides.
    panelBorderBg: [38, 38, 38],
    panelAccentText: [245, 245, 245],
    panelInstructionText: [245, 245, 245],
    panelPrimaryText: [245, 245, 245],
    panelSecondaryText: [245, 245, 245],
    panelSurfaceBg: [38, 38, 38],
  },
  light: {
    panelBorderBg: [245, 245, 245],
    panelAccentText: [30, 34, 40],
    panelInstructionText: [100, 105, 112],
    panelPrimaryText: [34, 38, 44],
    panelSecondaryText: [84, 89, 96],
    panelSurfaceBg: [245, 245, 245],
  },
} as const satisfies Record<
  SpacePanelSurfaceVariant,
  {
    panelBorderBg: RgbTriplet;
    panelAccentText: RgbTriplet;
    panelInstructionText: RgbTriplet;
    panelPrimaryText: RgbTriplet;
    panelSecondaryText: RgbTriplet;
    panelSurfaceBg: RgbTriplet;
  }
>;

type PanelTextTone = "accent" | "instruction" | "primary" | "secondary";

export const spacePiTuiTheme = {
  accentText: (text: string) => pc.cyan(text),
  transcriptText: (text: string) => text,
  statusText: (text: string) => pc.dim(text),
  composerLabel: (text: string) => pc.dim(text),
  dimText: (text: string) => pc.dim(text),
  resolvePanelBorderBg(
    surfaceVariant: SpacePanelSurfaceVariant
  ): (text: string) => string {
    const panelTheme = panelSurfaceThemes[surfaceVariant];
    const rgb = panelTheme.panelBorderBg;
    const backgroundOpen = buildAnsiColorOpen("48", rgb);
    return (text: string) => `${backgroundOpen}${text}${ANSI_RESET_BACKGROUND}`;
  },
  resolvePanelSurfaceBg(
    surfaceVariant: SpacePanelSurfaceVariant
  ): (text: string) => string {
    const panelTheme = panelSurfaceThemes[surfaceVariant];
    const backgroundOpen = buildAnsiColorOpen("48", panelTheme.panelSurfaceBg);
    return (text: string) => `${backgroundOpen}${text}${ANSI_RESET_BACKGROUND}`;
  },
  renderPanelTextLine(input: {
    surfaceVariant: SpacePanelSurfaceVariant;
    text: string;
    tone: PanelTextTone;
  }): string {
    const panelTheme = panelSurfaceThemes[input.surfaceVariant];
    const fg = resolvePanelTextTone(panelTheme, input.tone);
    return renderAnsiStyledText({ fg, text: input.text });
  },
};

function resolvePanelTextTone(
  panelTheme: (typeof panelSurfaceThemes)[SpacePanelSurfaceVariant],
  tone: PanelTextTone
): RgbTriplet {
  switch (tone) {
    case "accent":
      return panelTheme.panelAccentText;
    case "instruction":
      return panelTheme.panelInstructionText;
    case "primary":
      return panelTheme.panelPrimaryText;
    case "secondary":
      return panelTheme.panelSecondaryText;
    default:
      return panelTheme.panelPrimaryText;
  }
}

function renderAnsiStyledText(input: {
  fg?: RgbTriplet;
  text: string;
}): string {
  const fgOpen = input.fg ? buildAnsiColorOpen("38", input.fg) : "";
  if (!fgOpen) {
    return input.text;
  }
  return `${fgOpen}${input.text}${ANSI_RESET_FOREGROUND}`;
}

function buildAnsiColorOpen(prefix: "38" | "48", rgb: RgbTriplet): string {
  const [red, green, blue] = rgb;
  return `\x1B[${prefix};2;${red};${green};${blue}m`;
}
