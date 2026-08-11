"use client";

import ClaudeCodeColor from "@lobehub/icons/es/ClaudeCode/components/Color.js";
import CodexColor from "@lobehub/icons/es/Codex/components/Color.js";
import CursorMono from "@lobehub/icons/es/Cursor/components/Mono.js";
import {
  AVATAR_BACKGROUND as CURSOR_AVATAR_BACKGROUND,
  AVATAR_COLOR as CURSOR_AVATAR_COLOR,
} from "@lobehub/icons/es/Cursor/style.js";
import OpenClawColor from "@lobehub/icons/es/OpenClaw/components/Color.js";
import OpenCodeMono from "@lobehub/icons/es/OpenCode/components/Mono.js";
import {
  AVATAR_BACKGROUND as OPENCODE_AVATAR_BACKGROUND,
  AVATAR_COLOR as OPENCODE_AVATAR_COLOR,
} from "@lobehub/icons/es/OpenCode/style.js";
import {
  type BuiltinAgentControllerBrandId,
  resolveBuiltinAgentControllerBrand,
} from "@openmeld/schemas";
import type { ComponentType } from "react";
import { cn } from "#lib/utils";

type LocalAgentLogoComponent = ComponentType<{
  className?: string;
}>;

const LOCAL_AGENT_LOGO_COMPONENTS = {
  "claude-code": ClaudeCodeColor,
  codex: CodexColor,
  cursor: CursorLogo,
  opencode: OpenCodeLogo,
  openclaw: OpenClawColor,
} as const satisfies Record<
  BuiltinAgentControllerBrandId,
  LocalAgentLogoComponent
>;

function OpenCodeLogo({
  className,
  variant = "default",
}: {
  className?: string;
  variant?: LocalAgentLogoVariant;
}) {
  if (variant === "plain") {
    return <OpenCodeMono className={className} />;
  }

  return (
    <span
      className={cn("inline-grid place-items-center", className)}
      style={{
        backgroundColor: OPENCODE_AVATAR_BACKGROUND,
        color: OPENCODE_AVATAR_COLOR,
      }}
    >
      <OpenCodeMono className="h-3/4 w-3/4" />
    </span>
  );
}

function CursorLogo({
  className,
  variant = "default",
}: {
  className?: string;
  variant?: LocalAgentLogoVariant;
}) {
  if (variant === "plain") {
    return <CursorMono className={className} />;
  }

  return (
    <span
      className={cn("inline-grid place-items-center", className)}
      style={{
        backgroundColor: CURSOR_AVATAR_BACKGROUND,
        color: CURSOR_AVATAR_COLOR,
      }}
    >
      <CursorMono className="h-3/5 w-3/5" />
    </span>
  );
}

const LOCAL_AGENT_LOGO_SIZE_CLASS_NAMES = {
  md: "h-5 w-5",
  sm: "h-4 w-4",
  xs: "h-3.5 w-3.5",
} as const;

type LocalAgentLogoVariant = "default" | "plain";

type LocalAgentLogoProps = {
  agentId: string;
  className?: string;
  size?: keyof typeof LOCAL_AGENT_LOGO_SIZE_CLASS_NAMES;
  variant?: LocalAgentLogoVariant;
};

export function LocalAgentLogo({
  agentId,
  className,
  size = "sm",
  variant = "default",
}: LocalAgentLogoProps) {
  const resolvedLogo = resolveLocalAgentLogo(agentId);

  if (!resolvedLogo) {
    return null;
  }

  const { controllerId, Icon } = resolvedLogo;
  let logo = <Icon className="h-full w-full" />;
  if (controllerId === "opencode") {
    logo = <OpenCodeLogo className="h-full w-full" variant={variant} />;
  } else if (controllerId === "cursor") {
    logo = <CursorLogo className="h-full w-full" variant={variant} />;
  }

  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 items-center justify-center",
        LOCAL_AGENT_LOGO_SIZE_CLASS_NAMES[size],
        className
      )}
      data-testid={`local-agent-logo-${controllerId}`}
    >
      {logo}
    </span>
  );
}

export function hasLocalAgentLogo(agentId: string): boolean {
  return resolveLocalAgentLogo(agentId) !== undefined;
}

function resolveLocalAgentLogo(agentId: string):
  | {
      controllerId: BuiltinAgentControllerBrandId;
      Icon: LocalAgentLogoComponent;
    }
  | undefined {
  const brand = resolveBuiltinAgentControllerBrand(agentId);
  return brand
    ? {
        controllerId: brand.controllerId,
        Icon: LOCAL_AGENT_LOGO_COMPONENTS[brand.controllerId],
      }
    : undefined;
}
