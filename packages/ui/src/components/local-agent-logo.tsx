"use client";

import AntigravityColor from "@lobehub/icons/es/Antigravity/components/Color.js";
import ClaudeColor from "@lobehub/icons/es/Claude/components/Color.js";
import CodexColor from "@lobehub/icons/es/Codex/components/Color.js";
import CursorMono from "@lobehub/icons/es/Cursor/components/Mono.js";
import GrokMono from "@lobehub/icons/es/Grok/components/Mono.js";
import OpenAIMono from "@lobehub/icons/es/OpenAI/components/Mono.js";
import OpenClawColor from "@lobehub/icons/es/OpenClaw/components/Color.js";
import OpenCodeMono from "@lobehub/icons/es/OpenCode/components/Mono.js";
import {
  type BuiltinAgentControllerBrandId,
  resolveBuiltinAgentControllerBrand,
} from "@openmeld/schemas";
import type { ComponentType } from "react";
import { cn } from "#lib/utils";

// Official installed Grok Bot app mark; provenance lives beside the shared asset.
function GrokBotLogo({ className }: { className?: string }) {
  return (
    // biome-ignore lint/performance/noImgElement: shared Vite clients use this small local brand asset.
    <img
      alt=""
      className={className}
      height={256}
      src="/agent-logos/grok-bot.png"
      width={256}
    />
  );
}

const LOCAL_AGENT_LOGOS = {
  antigravity: { Icon: AntigravityColor, inset: "h-3/4 w-3/4" },
  "claude-code": { Icon: ClaudeColor, inset: "h-3/4 w-3/4" },
  codex: { Icon: CodexColor, inset: "h-full w-full" },
  cursor: { Icon: CursorMono, inset: "h-3/5 w-3/5" },
  "grok-build": { Icon: GrokMono, inset: "h-3/4 w-3/4" },
  "grok-bot": { Icon: GrokBotLogo, inset: "h-full w-full" },
  opencode: { Icon: OpenCodeMono, inset: "h-3/4 w-3/4" },
  openclaw: { Icon: OpenClawColor, inset: "h-3/4 w-3/4" },
} as const satisfies Record<
  BuiltinAgentControllerBrandId,
  { Icon: ComponentType<{ className?: string }>; inset: string }
>;

const LOCAL_AGENT_LOGO_SIZE_CLASS_NAMES = {
  md: "h-5 w-5",
  sm: "h-4 w-4",
  xs: "h-3.5 w-3.5",
} as const;

type LocalAgentLogoProps = {
  codexLogo?: "codex" | "openai";
  agentId: string;
  className?: string;
  size?: keyof typeof LOCAL_AGENT_LOGO_SIZE_CLASS_NAMES;
  variant?: "default" | "plain" | "tile";
};

/**
 * Raised surface with depth shared by every Agent tile: the Harness logo and
 * the Agent avatar in message rows. Callers add their own corner radius.
 */
export const RAISED_TILE_SURFACE_CLASS_NAME =
  "relative overflow-hidden bg-surface-2 shadow-surface-3 after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:shadow-surface-3";

export function LocalAgentLogo({
  codexLogo = "codex",
  agentId,
  className,
  size = "sm",
  variant = "default",
}: LocalAgentLogoProps) {
  const brand = resolveBuiltinAgentControllerBrand(agentId);
  if (!brand) {
    return null;
  }
  const { Icon: AgentIcon, inset } = LOCAL_AGENT_LOGOS[brand.controllerId];
  const Icon =
    brand.controllerId === "codex" && codexLogo === "openai"
      ? OpenAIMono
      : AgentIcon;
  return (
    <span
      aria-hidden="true"
      className={cn(
        "pointer-events-none inline-flex shrink-0 items-center justify-center",
        variant !== "plain" && "text-foreground",
        variant === "tile" && cn("rounded-lg", RAISED_TILE_SURFACE_CLASS_NAME),
        LOCAL_AGENT_LOGO_SIZE_CLASS_NAMES[size],
        className
      )}
      data-testid={`local-agent-logo-${brand.controllerId}`}
    >
      <Icon className={variant === "plain" ? "h-full w-full" : inset} />
    </span>
  );
}
