"use client";

import AnthropicMono from "@lobehub/icons/es/Anthropic/components/Mono.js";
import GeminiColor from "@lobehub/icons/es/Gemini/components/Color.js";
import GrokMono from "@lobehub/icons/es/Grok/components/Mono.js";
import OpenAIMono from "@lobehub/icons/es/OpenAI/components/Mono.js";
import { CENTER_AGENT_BOT_AVATAR_TYPES } from "@openmeld/schemas";
import {
	FluidAvatar,
	type FluidAvatarProps,
} from "@openmeld/ui/components/fluid-avatar";
import { cn } from "@openmeld/ui/lib/utils";
import { RobotIcon } from "@phosphor-icons/react";
import { BotAvatar, type BotAvatarType } from "bot-avatars";
import { useReducedMotion } from "motion/react";
import { type ComponentType, useRef } from "react";

export const CENTER_AGENT_BOT_TYPES =
	CENTER_AGENT_BOT_AVATAR_TYPES satisfies readonly BotAvatarType[];

export type AgentAvatarStyle =
	| "automatic"
	| "fluid"
	| (typeof CENTER_AGENT_BOT_TYPES)[number];

export function defaultCenterAgentAvatar(
	profileId: string
): (typeof CENTER_AGENT_BOT_TYPES)[number] {
	let hash = 0;
	for (const character of profileId) {
		hash = (hash * 31 + character.charCodeAt(0)) % 2_147_483_647;
	}
	return CENTER_AGENT_BOT_TYPES[hash % CENTER_AGENT_BOT_TYPES.length];
}

const MODEL_VENDOR_ICONS: Record<
	string,
	ComponentType<{ className?: string }>
> = {
	anthropic: AnthropicMono,
	google: GeminiColor,
	openai: OpenAIMono,
	"x-ai": GrokMono,
};

export function resolveHostedModelVendor(
	modelId: string | null | undefined
): string | null {
	const vendor = modelId?.split("/", 1)[0] ?? null;
	return vendor && Object.hasOwn(MODEL_VENDOR_ICONS, vendor) ? vendor : null;
}

export function RemoteAgentAvatar({
	profileName,
	profileId,
	avatarStyle,
	modelId,
	working = false,
	clickable = false,
	animated = working,
	shape = "rounded-square",
	animateOnHover = false,
	className,
	size = 64,
	...props
}: Omit<FluidAvatarProps, "seed" | "fallback"> & {
	profileName: string;
	profileId?: string;
	avatarStyle?: AgentAvatarStyle | null;
	modelId?: string | null;
	working?: boolean;
	clickable?: boolean;
}) {
	const botCanvas = useRef<HTMLCanvasElement>(null);
	const reducedMotion = useReducedMotion() === true;
	const isCenterAgent = shape === "circle";
	const selectedStyle =
		avatarStyle ??
		(isCenterAgent
			? defaultCenterAgentAvatar(profileId ?? profileName)
			: "automatic");
	if (selectedStyle === "fluid") {
		return (
			<FluidAvatar
				{...props}
				animated={animated}
				animateOnHover={animateOnHover}
				aria-hidden="true"
				className={className}
				fallback={<RobotIcon className="h-1/2 w-1/2 text-white/80" />}
				seed={profileId ?? profileName}
				shape={shape}
				size={size}
			/>
		);
	}
	if (selectedStyle !== "automatic") {
		const bot = (
			<BotAvatar
				aria-hidden="true"
				interactive={clickable && !reducedMotion}
				jumpEvery={working ? 8 : 0}
				paused={reducedMotion || !(working || clickable)}
				ref={botCanvas}
				size={size}
				state={working ? "working" : "default"}
				type={selectedStyle}
			/>
		);
		return clickable ? (
			<button
				{...props}
				aria-label={`Animate ${profileName}'s avatar`}
				className={cn(
					"inline-flex shrink-0 items-center justify-center",
					className
				)}
				onClick={(event) => {
					if (event.target === event.currentTarget) {
						botCanvas.current?.click();
					}
				}}
				style={{ width: size, height: size }}
				type="button"
			>
				{bot}
			</button>
		) : (
			<span
				{...props}
				aria-hidden="true"
				className={cn(
					"inline-flex shrink-0 items-center justify-center",
					className
				)}
				style={{ width: size, height: size }}
			>
				{bot}
			</span>
		);
	}
	const Icon =
		MODEL_VENDOR_ICONS[resolveHostedModelVendor(modelId) ?? ""] ?? RobotIcon;
	return (
		<span
			{...props}
			aria-hidden="true"
			className={cn(
				"inline-flex shrink-0 items-center justify-center bg-surface-2 text-foreground",
				isCenterAgent ? "rounded-full" : "rounded-[22%]",
				className
			)}
			style={{ width: size, height: size }}
		>
			<Icon className="h-3/5 w-3/5" />
		</span>
	);
}
