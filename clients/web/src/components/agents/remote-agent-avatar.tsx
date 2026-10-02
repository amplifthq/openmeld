"use client";

import {
	CENTER_AGENT_BOT_AVATAR_TYPES,
	HOSTED_REMOTE_AGENT_CONTROLLER_REF,
} from "@openmeld/schemas";
import type { AuthProfileView } from "@openmeld/schemas/types";
import {
	Avatar,
	AvatarFallback,
	AvatarImage,
} from "@openmeld/ui/components/avatar";
import {
	FluidAvatar,
	type FluidAvatarProps,
} from "@openmeld/ui/components/fluid-avatar";
import { LocalAgentLogo } from "@openmeld/ui/components/local-agent-logo";
import { useMediaQuery } from "@openmeld/ui/hooks/use-media-query";
import { cn } from "@openmeld/ui/lib/utils";
import { RobotIcon } from "@phosphor-icons/react";
import { BotAvatar, type BotAvatarType } from "bot-avatars";
import { useRef } from "react";
import { ModelBrandIcon } from "#/components/models/model-brand-icon";
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
	avatarImageUrl?: string | null;
	modelId?: string | null;
	agentControllerRef?: string | null;
	working?: boolean;
	clickable?: boolean;
	preview?: boolean;
	fallbackTestId?: string;
};

export function RemoteAgentAvatar(input: AgentAvatarProps) {
	const savedProfile = useAgentAvatarProfile(input.profileId);
	const profile = input.preview ? undefined : savedProfile;
	const controllerRef = profile
		? profile.agentControllerRef
		: input.agentControllerRef;
	const avatarImageUrl =
		controllerRef === HOSTED_REMOTE_AGENT_CONTROLLER_REF
			? (profile?.avatarUrl ?? input.avatarImageUrl)
			: undefined;
	return (
		<AgentAvatarPresentation
			{...input}
			avatarImageUrl={avatarImageUrl}
			{...(profile
				? {
						avatarStyle: profile.avatarStyle,
						modelId:
							profile.avatarModelId === undefined
								? input.modelId
								: profile.avatarModelId,
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
	avatarImageUrl,
	modelId,
	agentControllerRef,
	preview: _preview,
	fallbackTestId,
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
	const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
	const identity = resolveAgentAvatarIdentity({
		agentControllerRef,
		avatarStyle,
		modelId,
		isCenterAgent: shape === "circle",
	});
	const selectedStyle = identity.style;
	shape = identity.shape;
	const identityAttributes = {
		"data-avatar-style": selectedStyle,
		"data-avatar-shape": shape,
		"data-avatar-icon": identity.icon,
	};
	if (avatarImageUrl) {
		return (
			<AgentAvatarImage
				{...props}
				{...identityAttributes}
				avatarImageUrl={avatarImageUrl}
				className={className}
				shape={shape}
				size={size}
			/>
		);
	}
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
		const paused = reducedMotion || !(working || clickable);
		const bot = (
			<BotAvatar
				aria-hidden="true"
				interactive={clickable && !reducedMotion}
				jumpEvery={working ? 8 : 0}
				// Pausing freezes the current frame; reinitialize at the resting pose.
				key={`${working}:${paused}`}
				paused={paused}
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
					"inline-flex shrink-0 items-center justify-center overflow-visible",
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
					"inline-flex shrink-0 items-center justify-center overflow-visible",
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
				"inline-flex shrink-0 items-center justify-center overflow-hidden bg-surface-2 text-foreground",
				shape === "circle" ? "rounded-full" : "rounded-[22%]",
				className
			)}
			style={{ width: size, height: size }}
		>
			<AgentAvatarDefaultIcon
				fallbackTestId={fallbackTestId}
				identity={identity}
			/>
		</span>
	);
}

function AgentAvatarDefaultIcon({
	identity,
	fallbackTestId,
}: {
	identity: ReturnType<typeof resolveAgentAvatarIdentity>;
	fallbackTestId?: string;
}) {
	if (identity.providerBrand) {
		return (
			<ModelBrandIcon brand={identity.providerBrand} className="h-3/5 w-3/5" />
		);
	}
	if (identity.icon === "agent") {
		return <RobotIcon className="h-3/5 w-3/5" data-testid={fallbackTestId} />;
	}
	return (
		<LocalAgentLogo
			agentId={identity.icon}
			className="h-full w-full"
			size="md"
		/>
	);
}

function AgentAvatarImage({
	avatarImageUrl,
	className,
	shape,
	size,
	...props
}: Omit<FluidAvatarProps, "seed" | "fallback"> & { avatarImageUrl: string }) {
	return (
		<Avatar
			{...props}
			aria-hidden="true"
			className={cn(
				"overflow-hidden after:border-0",
				shape === "circle" ? "rounded-full" : "rounded-[22%]",
				className
			)}
			data-avatar-icon="image"
			style={{ width: size, height: size }}
		>
			<AvatarImage
				alt=""
				className="rounded-[inherit]"
				referrerPolicy="no-referrer"
				src={avatarImageUrl}
			/>
			<AvatarFallback className="rounded-[inherit]">
				<RobotIcon className="h-3/5 w-3/5" />
			</AvatarFallback>
		</Avatar>
	);
}
