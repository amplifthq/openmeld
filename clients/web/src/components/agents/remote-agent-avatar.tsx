"use client";

import { CENTER_AGENT_BOT_AVATAR_TYPES } from "@openmeld/schemas";
import type { AuthProfileView } from "@openmeld/schemas/types";
import {
	FluidAvatar,
	type FluidAvatarProps,
} from "@openmeld/ui/components/fluid-avatar";
import { LocalAgentLogo } from "@openmeld/ui/components/local-agent-logo";
import { cn } from "@openmeld/ui/lib/utils";
import { RobotIcon } from "@phosphor-icons/react";
import { BotAvatar, type BotAvatarType } from "bot-avatars";
import { useReducedMotion } from "motion/react";
import { useRef } from "react";
import { useAgentAvatarProfile } from "#/query/profiles/agent-avatar-context";
import { resolveAgentAvatarIdentity } from "./agent-avatar-identity";

export const CENTER_AGENT_BOT_TYPES =
	CENTER_AGENT_BOT_AVATAR_TYPES satisfies readonly BotAvatarType[];

export type AgentAvatarStyle = NonNullable<AuthProfileView["avatarStyle"]>;

type AgentAvatarProps = Omit<FluidAvatarProps, "seed" | "fallback" | "size"> & {
	size?: number;
	profileName: string;
	profileId?: string;
	avatarStyle?: AgentAvatarStyle | null;
	// Retained for caller compatibility; model choice never determines identity.
	modelId?: string | null;
	agentControllerRef?: string | null;
	working?: boolean;
	clickable?: boolean;
	preview?: boolean;
	fallbackTestId?: string;
	variant?: "default" | "plain";
};

export function RemoteAgentAvatar(input: AgentAvatarProps) {
	const savedProfile = useAgentAvatarProfile(input.profileId);
	const profile = input.preview ? undefined : savedProfile;
	return (
		<AgentAvatarPresentation
			{...input}
			{...(profile
				? {
						avatarStyle: profile.avatarStyle,
						agentControllerRef: profile.agentControllerRef,
						shape: resolveAgentAvatarIdentity(profile).shape,
					}
				: {})}
		/>
	);
}

function AgentAvatarPresentation({
	profileName,
	profileId,
	avatarStyle,
	modelId: _modelId,
	agentControllerRef,
	preview: _preview,
	fallbackTestId,
	variant = "default",
	working = false,
	clickable = false,
	animated = working,
	shape = "rounded-square",
	animateOnHover = false,
	className,
	size = 64,
	...props
}: AgentAvatarProps) {
	const botCanvas = useRef<HTMLCanvasElement>(null);
	const reducedMotion = useReducedMotion() === true;
	const identity = resolveAgentAvatarIdentity({
		agentControllerRef,
		avatarStyle,
		isCenterAgent: shape === "circle",
	});
	const selectedStyle = identity.style;
	shape = identity.shape;
	const identityAttributes = {
		"data-avatar-style": selectedStyle,
		"data-avatar-shape": shape,
		"data-avatar-icon": identity.icon,
	};
	if (selectedStyle === "fluid") {
		return (
			<FluidAvatar
				{...props}
				{...identityAttributes}
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
				{...identityAttributes}
				className={cn(
					"inline-flex shrink-0 items-center justify-center overflow-hidden",
					shape === "circle" ? "rounded-full" : "rounded-[22%]",
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
				{...identityAttributes}
				className={cn(
					"inline-flex shrink-0 items-center justify-center overflow-hidden",
					shape === "circle" ? "rounded-full" : "rounded-[22%]",
					className
				)}
				style={{ width: size, height: size }}
			>
				{bot}
			</span>
		);
	}
	return (
		<span
			{...props}
			aria-hidden="true"
			{...identityAttributes}
			className={cn(
				"inline-flex shrink-0 items-center justify-center overflow-hidden text-foreground",
				variant !== "plain" && "bg-surface-2",
				shape === "circle" ? "rounded-full" : "rounded-[22%]",
				className
			)}
			style={{ width: size, height: size }}
		>
			{identity.icon === "agent" ? (
				<RobotIcon
					className={variant === "plain" ? "h-full w-full" : "h-3/5 w-3/5"}
					data-testid={fallbackTestId}
				/>
			) : (
				<LocalAgentLogo
					agentId={identity.icon}
					className="h-full w-full"
					size="md"
					variant={variant}
				/>
			)}
		</span>
	);
}
