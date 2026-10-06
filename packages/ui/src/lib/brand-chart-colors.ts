import {
  BUILTIN_AGENT_CONTROLLER_BRANDS,
  resolveBuiltinAgentControllerBrand,
} from "@openmeld/schemas";

export type BrandChartColors = { light: string[]; dark: string[] };

// Product chart accents, not a claim about vendors' official logo colors.
// Related model and Local Agent brands share the existing controller accent.
const modelAccents: Record<string, string> = {
  OpenAI: BUILTIN_AGENT_CONTROLLER_BRANDS.codex.accentHex,
  Anthropic: BUILTIN_AGENT_CONTROLLER_BRANDS["claude-code"].accentHex,
  Google: BUILTIN_AGENT_CONTROLLER_BRANDS.antigravity.accentHex,
  xAI: BUILTIN_AGENT_CONTROLLER_BRANDS["grok-build"].accentHex,
  DeepSeek: "#569ecb",
  "Z.ai": "#2aafa0",
  "Moonshot AI": "#929aa8",
  MiniMax: "#cb87d0",
  Alibaba: "#a18cda",
  Xiaomi: "#c49a47",
  Meta: "#569ecb",
  Mistral: "#c49a47",
};

const monochromeAccents: Record<string, string> = {
  cursor: "#c49a47",
  opencode: "#2aafa0",
};
const unknownAccent = "#929aa8";

function mixColor(hex: string, amount: number, target = 0): string {
  return `#${[1, 3, 5]
    .map((offset) => {
      const channel = Number.parseInt(hex.slice(offset, offset + 2), 16);
      return Math.round(channel + (target - channel) * amount)
        .toString(16)
        .padStart(2, "0");
    })
    .join("")}`;
}

function chartColors(accent: string): BrandChartColors {
  return { light: [mixColor(accent, 0.28)], dark: [accent] };
}

export function localAgentChartColors(
  controller: string | null
): BrandChartColors {
  const brand = resolveBuiltinAgentControllerBrand(controller);
  return chartColors(
    monochromeAccents[brand?.controllerId ?? ""] ??
      brand?.accentHex ??
      unknownAccent
  );
}

export function modelBrandChartColors(
  brand: string | null,
  variant: "base" | "lighter" | "darker" = "base"
): BrandChartColors {
  const accent = brand ? modelAccents[brand] : undefined;
  if (!accent) {
    return chartColors(unknownAccent);
  }
  if (variant === "lighter") {
    return chartColors(mixColor(accent, 0.32, 255));
  }
  if (variant === "darker") {
    return chartColors(mixColor(accent, 0.2));
  }
  return chartColors(accent);
}
