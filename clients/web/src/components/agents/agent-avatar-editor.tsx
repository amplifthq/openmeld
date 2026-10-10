"use client";

import {
	HOSTED_CENTER_AGENT_CONTROLLER_REF,
	HOSTED_REMOTE_AGENT_CONTROLLER_REF,
} from "@openmeld/agent-runtime";
import { Button } from "@openmeld/ui/components/button";
import {
	CaretLeftIcon,
	CaretRightIcon,
	CheckIcon,
} from "@phosphor-icons/react";
import { useState } from "react";
import { useAgentAvatarProfile } from "#/query/profiles/agent-avatar-context";
import {
	type AgentAvatarStyle,
	CENTER_AGENT_BOT_TYPES,
	RemoteAgentAvatar,
} from "./remote-agent-avatar";

export function AgentAvatarEditor(input: {
	profileId: string;
	profileName: string;
	avatarStyle?: AgentAvatarStyle | null;
	modelId?: string | null;
	size?: number;
	centerAgent: boolean;
	canEdit: boolean;
	saving: boolean;
	onSave: (style: AgentAvatarStyle) => Promise<void>;
}) {
	const savedProfile = useAgentAvatarProfile(input.profileId);
	const current =
		(savedProfile ? savedProfile.avatarStyle : input.avatarStyle) ??
		"automatic";
	const choices: readonly AgentAvatarStyle[] = input.centerAgent
		? [...CENTER_AGENT_BOT_TYPES, "fluid"]
		: ["automatic", "fluid"];
	const [candidate, setCandidate] = useState<AgentAvatarStyle | null>(null);
	const [open, setOpen] = useState(false);
	const size = input.size ?? 64;
	const changed = input.canEdit && candidate !== null && candidate !== current;
	const rotate = (step: number) => {
		const index = choices.indexOf(candidate ?? current);
		setCandidate(choices[(index + step + choices.length) % choices.length]);
		setOpen(true);
	};
	const navigationClassName = `absolute top-1/2 z-10 grid size-6 -translate-y-1/2 place-items-center rounded-full bg-background/85 text-foreground shadow-sm [@media(hover:none)]:opacity-100 focus-visible:outline-2 focus-visible:outline-ring ${open ? "opacity-100" : "opacity-0 group-focus-within/avatar-editor:opacity-100 group-hover/avatar-editor:opacity-100"}`;
	return (
		<div
			className="group/avatar-editor flex shrink-0 flex-col items-center"
			style={{ width: size }}
		>
			<div className="relative" style={{ width: size, height: size }}>
				<RemoteAgentAvatar
					agentControllerRef={
						input.centerAgent
							? HOSTED_CENTER_AGENT_CONTROLLER_REF
							: HOSTED_REMOTE_AGENT_CONTROLLER_REF
					}
					avatarStyle={changed ? candidate : current}
					botInteraction="playful"
					clickable
					modelId={input.modelId}
					preview={changed}
					profileId={input.profileId}
					profileName={input.profileName}
					shape={input.centerAgent ? "circle" : "rounded-square"}
					size={size}
				/>
				{input.canEdit ? (
					<>
						<button
							aria-label="Previous avatar"
							className={`${navigationClassName} left-0`}
							disabled={input.saving}
							onClick={(event) => {
								event.stopPropagation();
								rotate(-1);
							}}
							type="button"
						>
							<CaretLeftIcon
								aria-hidden="true"
								className="size-3.5"
								weight="bold"
							/>
						</button>
						<button
							aria-label="Next avatar"
							className={`${navigationClassName} right-0`}
							disabled={input.saving}
							onClick={(event) => {
								event.stopPropagation();
								rotate(1);
							}}
							type="button"
						>
							<CaretRightIcon
								aria-hidden="true"
								className="size-3.5"
								weight="bold"
							/>
						</button>
					</>
				) : null}
			</div>
			{input.canEdit ? (
				<div className="min-h-7 w-full max-lg:min-h-11">
					{changed ? (
						<Button
							aria-label="Save avatar"
							className="w-full"
							disabled={input.saving}
							onClick={async (event) => {
								event.stopPropagation();
								try {
									await input.onSave(candidate ?? current);
									setCandidate(null);
									setOpen(false);
								} catch {
									// The caller reports the save error; restore the saved identity.
									setCandidate(null);
									setOpen(false);
								}
							}}
							size="sm"
							variant="secondary"
						>
							<CheckIcon aria-hidden="true" className="size-3" weight="bold" />
							Save
						</Button>
					) : null}
				</div>
			) : null}
		</div>
	);
}
