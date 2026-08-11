import { stripVTControlCharacters } from "node:util";
import pc from "picocolors";
import {
  formatOpenMeldCliCommand,
  resolveUserFacingCliEntryCommand,
} from "../runtime/cli-entry-command";
import { formatCliVersionSummary } from "../runtime/cli-version";
import { outLine } from "./io";
import {
  ROOT_ENTRY_COMMANDS,
  ROOT_ENTRY_START_COMMAND,
} from "./root-entry-catalog";

const ANSI_RESET = "\x1b[0m";
const LOGO_SCALE = 1;
const LOGO_COLORS = [
  "\x1b[38;5;250m",
  "\x1b[38;5;248m",
  "\x1b[38;5;246m",
  "\x1b[38;5;244m",
  "\x1b[38;5;242m",
  "\x1b[38;5;240m",
];

const OPENMELD_LOGO_LINES = [
  " ██████╗ ██████╗ ███████╗███╗   ██╗███╗   ███╗███████╗██╗     ██████╗",
  "██╔═══██╗██╔══██╗██╔════╝████╗  ██║████╗ ████║██╔════╝██║     ██╔══██╗",
  "██║   ██║██████╔╝█████╗  ██╔██╗ ██║██╔████╔██║█████╗  ██║     ██║  ██║",
  "██║   ██║██╔═══╝ ██╔══╝  ██║╚██╗██║██║╚██╔╝██║██╔══╝  ██║     ██║  ██║",
  "╚██████╔╝██║     ███████╗██║ ╚████║██║ ╚═╝ ██║███████╗███████╗██████╔╝",
  " ╚═════╝ ╚═╝     ╚══════╝╚═╝  ╚═══╝╚═╝     ╚═╝╚══════╝╚══════╝╚═════╝ ",
];
const OPENMELD_SUBTITLE_LINES = [
  "OPENMELD CLI • https://openmeld.ai",
  "People and agents, working as one.",
];
const OPENMELD_CLI_NPX_COMMAND = "npx -y openmeld@latest";
const GLOBAL_INSTALL_COMMAND = "npm install -g openmeld";
const GLOBAL_INSTALL_SHORTCUT_COMMAND = "openmeld start";
export const OPENMELD_BRAND_SURFACE_BG_RGB = [20, 56, 60] as const;
export const OPENMELD_COMPOSER_SURFACE_BG_RGB = [38, 38, 38] as const;

export function renderOpenMeldLogo(): string {
  const useColor = pc.isColorSupported;
  const scaled = scaleMonospaceBlock(OPENMELD_LOGO_LINES, LOGO_SCALE);
  return scaled
    .map((line, index) => {
      if (!useColor) {
        return line;
      }
      const sourceIndex = Math.floor(index / LOGO_SCALE);
      const color =
        LOGO_COLORS[sourceIndex] ?? LOGO_COLORS.at(-1) ?? "\x1b[37m";
      return `${color}${line}${ANSI_RESET}`;
    })
    .join("\n");
}

export function renderOpenMeldHeader(): string {
  return `${renderOpenMeldLogo()}\n${renderOpenMeldTagline()}`;
}

export function renderOpenMeldBrandBlockLines(): string[] {
  return [
    ...renderOpenMeldLogo().split("\n"),
    ...renderOpenMeldTagline().split("\n"),
    pc.dim(formatCliVersionSummary()),
  ];
}

export function renderOpenMeldBrandAccent(text: string): string {
  return pc.bold(pc.cyan(text));
}

export function printOpenMeldBanner(): void {
  const startCallToAction = `${pc.dim("Try this first:")} ${pc.bold(
    pc.cyan(formatOpenMeldCliCommand(ROOT_ENTRY_START_COMMAND))
  )}`;
  outLine("");
  for (const line of renderOpenMeldBrandBlockLines()) {
    outLine(line);
  }
  outLine("");
  for (const line of renderThinCalloutBox(startCallToAction)) {
    outLine(line);
  }
  if (shouldRenderGlobalInstallHint()) {
    outLine("");
    for (const line of renderThinCalloutBox(buildGlobalInstallHintLines())) {
      outLine(line);
    }
  }
  outLine("");
  for (const item of ROOT_ENTRY_COMMANDS) {
    outLine(
      `  ${pc.dim("$")} ${pc.cyan(formatOpenMeldCliCommand(item.command))} ${pc.dim(item.description)}`
    );
  }
  outLine("");
}

export function renderOpenMeldTagline(): string {
  return OPENMELD_SUBTITLE_LINES.map((line) =>
    renderOpenMeldBrandAccent(line)
  ).join("\n");
}

function scaleMonospaceBlock(lines: string[], factor: number): string[] {
  if (factor <= 1) {
    return [...lines];
  }

  const output: string[] = [];
  for (const line of lines) {
    const scaledLine = [...line].map((char) => char.repeat(factor)).join("");
    for (let i = 0; i < factor; i += 1) {
      output.push(scaledLine);
    }
  }
  return output;
}

function shouldRenderGlobalInstallHint(): boolean {
  return resolveUserFacingCliEntryCommand() === OPENMELD_CLI_NPX_COMMAND;
}

function buildGlobalInstallHintLines(): string[] {
  return [
    pc.dim("Install OpenMeld globally for shorter commands:"),
    pc.bold(pc.cyan(GLOBAL_INSTALL_COMMAND)),
    `${pc.dim("After install, use:")} ${pc.bold(
      pc.cyan(GLOBAL_INSTALL_SHORTCUT_COMMAND)
    )}`,
  ];
}

function renderThinCalloutBox(content: string | string[]): string[] {
  const lines = Array.isArray(content) ? content : [content];
  const innerWidth =
    Math.max(...lines.map((line) => stripAnsi(line).length), 0) + 2;
  return [
    `${pc.dim("┌")}${pc.dim("─".repeat(innerWidth))}${pc.dim("┐")}`,
    ...lines.map((line) => {
      const padding = " ".repeat(innerWidth - stripAnsi(line).length - 1);
      return `${pc.dim("│")} ${line}${padding}${pc.dim("│")}`;
    }),
    `${pc.dim("└")}${pc.dim("─".repeat(innerWidth))}${pc.dim("┘")}`,
  ];
}

function stripAnsi(value: string): string {
  return stripVTControlCharacters(value);
}
