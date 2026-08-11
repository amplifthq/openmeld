"use client";

import {
	Avatar,
	AvatarFallback,
	AvatarImage,
} from "@openmeld/ui/components/avatar";
import { DitherAvatarBackground } from "@openmeld/ui/components/dither-avatar-background";
import { RobotIcon } from "@phosphor-icons/react";
import type { ComponentProps } from "react";

const DITHER_PROFILE_AVATAR_SEED_NAMESPACE =
	"openmeld-dither-profile-avatar:v1";
const PROFILE_NAME_WORD_SEPARATOR_PATTERN = /\s+/u;

export type DitherProfileAvatarKind = "center-agent" | "human";

type CommonDitherProfileAvatarProps = Omit<
	ComponentProps<typeof Avatar>,
	"children" | "size" | "style"
> & {
	profileId: string;
	profileName: string;
	size: number;
};

type DitherProfileAvatarProps = CommonDitherProfileAvatarProps &
	(
		| {
				avatarImageUrl?: string | null;
				profileKind: "human";
		  }
		| {
				avatarImageUrl?: never;
				profileKind: "center-agent";
		  }
	);

export function DitherProfileAvatar({
	avatarImageUrl,
	profileId,
	profileKind,
	profileName,
	size,
	...props
}: DitherProfileAvatarProps) {
	const seed = buildDitherProfileAvatarSeed({ profileId, profileKind });

	return (
		<Avatar
			{...props}
			aria-hidden="true"
			data-profile-kind={profileKind}
			style={{ height: size, width: size }}
		>
			{avatarImageUrl ? (
				<AvatarImage
					alt=""
					className="z-30"
					referrerPolicy="no-referrer"
					src={avatarImageUrl}
				/>
			) : null}
			<AvatarFallback className="isolate overflow-hidden bg-transparent text-white">
				<DitherAvatarBackground
					className="pointer-events-none z-0"
					data-profile-avatar-seed={seed}
					seed={seed}
					size={size}
				/>
				<span className="absolute inset-0 z-10 bg-black/15" />
				{profileKind === "human" ? (
					<span
						className="relative z-20 font-semibold leading-none [text-shadow:0_1px_2px_rgb(0_0_0_/_45%)]"
						style={{ fontSize: Math.max(9, Math.round(size * 0.38)) }}
					>
						{buildProfileInitials(profileName)}
					</span>
				) : (
					<RobotIcon
						aria-hidden="true"
						className="relative z-20 [filter:drop-shadow(0_1px_1px_rgb(0_0_0_/_55%))]"
						data-slot="center-agent-profile-avatar-glyph"
						size={Math.max(10, Math.round(size * 0.55))}
						weight="bold"
					/>
				)}
			</AvatarFallback>
		</Avatar>
	);
}

export function buildDitherProfileAvatarSeed(input: {
	profileId: string;
	profileKind: DitherProfileAvatarKind;
}): string {
	return `${DITHER_PROFILE_AVATAR_SEED_NAMESPACE}:${input.profileKind}:${input.profileId}`;
}

function buildProfileInitials(profileName: string): string {
	const words = profileName
		.trim()
		.split(PROFILE_NAME_WORD_SEPARATOR_PATTERN)
		.filter(Boolean);
	if (words.length === 0) {
		return "?";
	}
	return words
		.slice(0, 2)
		.map((word) => word.charAt(0).toUpperCase())
		.join("");
}
