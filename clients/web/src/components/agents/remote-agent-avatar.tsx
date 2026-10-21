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
	BotAvatar,
	type BotAvatarInteraction,
	type BotAvatarType,
} from "@openmeld/ui/components/bot-avatar";
import {
	FluidAvatar,
	type FluidAvatarProps,
} from "@openmeld/ui/components/fluid-avatar";
import {
	LocalAgentLogo,
	RAISED_TILE_SURFACE_CLASS_NAME,
} from "@openmeld/ui/components/local-agent-logo";
import { cn } from "@openmeld/ui/lib/utils";
import { RobotIcon } from "@phosphor-icons/react";
import { useRef } from "react";
import { ModelBrandIcon } from "#/components/models/model-brand-icon";
import { useBotAvatarPreference } from "#/lib/appearance/bot-avatar-preference";
import { useAgentAvatarProfile } from "#/query/profiles/agent-avatar-context";
import { AGENT_AVATAR_COLORS } from "./agent-avatar-colors";
import { resolveAgentAvatarIdentity } from "./agent-avatar-identity";

export const CENTER_AGENT_BOT_TYPES =
	CENTER_AGENT_BOT_AVATAR_TYPES satisfies readonly BotAvatarType[];

export type AgentAvatarStyle = NonNullable<AuthProfileView["avatarStyle"]>;

type AgentAvatarProps = Omit<FluidAvatarProps, "seed" | "fallback" | "size"> & {
	size?: number;
	profileName: string;
	profileId?: string;
	avatarStyle?: AgentAvatarStyle | null;
	avatarOptions?: AuthProfileView["avatarOptions"];
	avatarImageUrl?: string | null;
	modelId?: string | null;
	agentControllerRef?: string | null;
	working?: boolean;
	clickable?: boolean;
	botInteraction?: BotAvatarInteraction;
	followPointer?: boolean;
	preview?: boolean;
	fallbackTestId?: string;
	variant?: "default" | "plain";
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
						avatarOptions: profile.avatarOptions,
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
	avatarOptions,
	avatarImageUrl,
	modelId,
	agentControllerRef,
	preview: _preview,
	fallbackTestId,
	variant = "default",
	working = false,
	clickable = false,
	botInteraction = "subtle",
	followPointer,
	animated = working,
	shape = "rounded-square",
	animateOnHover = false,
	className,
	size = 64,
	...props
}: AgentAvatarProps) {
	const botCanvas = useRef<HTMLCanvasElement>(null);
	const { motionEnabled, shading, palette } = useBotAvatarPreference();
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
	const imageUrl = avatarOptions?.imageUrl ?? avatarImageUrl;
	if (imageUrl) {
		return (
			<AgentAvatarImage
				{...props}
				{...identityAttributes}
				avatarImageUrl={imageUrl}
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
				animated={animated && motionEnabled}
				animateOnHover={animateOnHover && motionEnabled}
				aria-hidden="true"
				className={className}
				fallback={<RobotIcon className="h-1/2 w-1/2 text-white/80" />}
				seed={avatarColorSeed(avatarOptions, profileId, profileName)}
				shape={shape}
				size={size}
			/>
		);
	}
	if (selectedStyle !== "automatic" && selectedStyle !== "custom") {
		const bot = (
			<BotAvatar
				aria-hidden="true"
				followPointer={followPointer}
				interaction={botInteraction}
				motionEnabled={motionEnabled}
				palette={avatarOptions?.palette ?? palette}
				ref={botCanvas}
				shading={shading}
				size={size}
				tabIndex={-1}
				type={selectedStyle}
				working={working}
			/>
		);
		return clickable && motionEnabled ? (
			<button
				{...props}
				aria-label={`Animate ${profileName}'s avatar`}
				{...identityAttributes}
				className={cn(
					"inline-flex shrink-0 items-center justify-center overflow-visible focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
					shape === "circle" ? "rounded-full" : "rounded-[22%]",
					className
				)}
				onClick={(event) => {
					if (event.target === event.currentTarget) {
						botCanvas.current?.click();
						return;
					}
					props.onClick?.(event);
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
				"inline-flex shrink-0 items-center justify-center overflow-hidden text-foreground",
				variant !== "plain" && RAISED_TILE_SURFACE_CLASS_NAME,
				shape === "circle" ? "rounded-full" : "rounded-[22%]",
				className
			)}
			style={{ width: size, height: size }}
		>
			<AgentAvatarDefaultIcon
				fallbackTestId={fallbackTestId}
				identity={identity}
				variant={variant}
			/>
		</span>
	);
}

function AgentAvatarDefaultIcon({
	identity,
	fallbackTestId,
	variant,
}: {
	identity: ReturnType<typeof resolveAgentAvatarIdentity>;
	fallbackTestId?: string;
	variant: "default" | "plain";
}) {
	if (identity.providerBrand) {
		return (
			<ModelBrandIcon
				brand={identity.providerBrand}
				className={variant === "plain" ? "h-full w-full" : "h-3/5 w-3/5"}
			/>
		);
	}
	if (identity.icon === "agent") {
		return (
			<RobotIcon
				className={variant === "plain" ? "h-full w-full" : "h-3/5 w-3/5"}
				data-testid={fallbackTestId}
			/>
		);
	}
	return (
		<LocalAgentLogo
			agentId={identity.icon}
			className="h-full w-full"
			size="md"
			variant={variant}
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
				"inline-flex overflow-hidden after:border-0",
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

function avatarColorSeed(
	options: AuthProfileView["avatarOptions"],
	profileId: string | undefined,
	profileName: string
) {
	return options?.color
		? AGENT_AVATAR_COLORS[options.color].seed
		: (profileId ?? profileName);
}
