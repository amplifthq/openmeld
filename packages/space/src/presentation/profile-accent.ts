import {
  type BuiltinAgentControllerBrand,
  resolveBuiltinAgentControllerBrand,
} from "@openmeld/schemas";

export type RgbColor = {
  r: number;
  g: number;
  b: number;
};

export type SpaceProfileAccentIdentity = {
  agentControllerRef?: string | null;
  ownerName?: string | null;
  ownerUserId?: string | null;
  profileId?: string | null;
  profileKind?: "human" | "agent" | "system" | null;
  profileName?: string | null;
};

export type SpaceProfileAccent = {
  accentHex: string | null;
  accentRgb: RgbColor | null;
  controllerDisplayName: string | null;
  enabled: boolean;
  surfaceRgb: RgbColor | null;
};

const BUILTIN_CONTROLLER_DISPLAY_NAME_BY_ID = {
  "claude-code": "Claude Code",
  codex: "Codex",
  cursor: "Cursor",
  opencode: "OpenCode",
  openclaw: "OpenClaw",
} as const satisfies Record<string, string>;

export function resolveSpaceProfileAccent(
  input: SpaceProfileAccentIdentity
): SpaceProfileAccent {
  const controllerDisplayName = resolveControllerDisplayName(
    input.agentControllerRef
  );
  if (input.profileKind !== "agent") {
    return {
      accentHex: null,
      accentRgb: null,
      controllerDisplayName,
      enabled: false,
      surfaceRgb: null,
    };
  }

  const builtinBrand = resolveBuiltinAgentControllerBrand(
    input.agentControllerRef
  );
  if (!builtinBrand) {
    return {
      accentHex: null,
      accentRgb: null,
      controllerDisplayName,
      enabled: false,
      surfaceRgb: null,
    };
  }

  const [red, green, blue] = builtinBrand.accentRgb;
  return {
    accentHex: builtinBrand.accentHex,
    accentRgb: {
      r: red,
      g: green,
      b: blue,
    },
    controllerDisplayName:
      BUILTIN_CONTROLLER_DISPLAY_NAME_BY_ID[builtinBrand.controllerId] ??
      controllerDisplayName,
    enabled: true,
    surfaceRgb: deriveBuiltinControllerBrandSurfaceRgb(builtinBrand),
  };
}

function resolveControllerDisplayName(
  agentControllerRef: string | null | undefined
): string | null {
  const normalized = String(agentControllerRef ?? "")
    .trim()
    .replaceAll(/\s+/g, " ");
  if (!normalized) {
    return null;
  }

  const builtinBrand = resolveBuiltinAgentControllerBrand(normalized);
  if (builtinBrand) {
    return BUILTIN_CONTROLLER_DISPLAY_NAME_BY_ID[builtinBrand.controllerId];
  }

  if (normalized.startsWith("builtin:")) {
    return normalized.slice("builtin:".length);
  }

  return normalized;
}

function deriveBuiltinControllerBrandSurfaceRgb(
  brand: BuiltinAgentControllerBrand
): RgbColor {
  const [red, green, blue] = brand.accentRgb;
  const { hue } = rgbToHsl(red, green, blue);
  return hslToRgb(hue, 0.24, 0.18);
}

function hslToRgb(
  hue: number,
  saturation: number,
  lightness: number
): RgbColor {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const huePrime = hue / 60;
  const second = chroma * (1 - Math.abs((huePrime % 2) - 1));

  let red = 0;
  let green = 0;
  let blue = 0;

  if (huePrime >= 0 && huePrime < 1) {
    red = chroma;
    green = second;
  } else if (huePrime < 2) {
    red = second;
    green = chroma;
  } else if (huePrime < 3) {
    green = chroma;
    blue = second;
  } else if (huePrime < 4) {
    green = second;
    blue = chroma;
  } else if (huePrime < 5) {
    red = second;
    blue = chroma;
  } else {
    red = chroma;
    blue = second;
  }

  const match = lightness - chroma / 2;
  return {
    r: Math.round((red + match) * 255),
    g: Math.round((green + match) * 255),
    b: Math.round((blue + match) * 255),
  };
}

function rgbToHsl(
  red: number,
  green: number,
  blue: number
): {
  hue: number;
  lightness: number;
  saturation: number;
} {
  const normalizedRed = red / 255;
  const normalizedGreen = green / 255;
  const normalizedBlue = blue / 255;
  const max = Math.max(normalizedRed, normalizedGreen, normalizedBlue);
  const min = Math.min(normalizedRed, normalizedGreen, normalizedBlue);
  const chroma = max - min;
  const lightness = (max + min) / 2;

  if (chroma === 0) {
    return { hue: 0, lightness, saturation: 0 };
  }

  const saturation = chroma / (1 - Math.abs(2 * lightness - 1));
  let huePrime = 0;

  if (max === normalizedRed) {
    huePrime = (normalizedGreen - normalizedBlue) / chroma;
  } else if (max === normalizedGreen) {
    huePrime = (normalizedBlue - normalizedRed) / chroma + 2;
  } else {
    huePrime = (normalizedRed - normalizedGreen) / chroma + 4;
  }

  return {
    hue: normalizeHue(huePrime * 60),
    lightness,
    saturation,
  };
}

function normalizeHue(value: number): number {
  const normalized = value % 360;
  return normalized >= 0 ? normalized : normalized + 360;
}
