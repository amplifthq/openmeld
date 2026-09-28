"use client";

import { AvatarAction } from "@openmeld/ui/components/avatar";
import {
	CaretLeftIcon,
	CaretRightIcon,
	CheckIcon,
} from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import {
	type AgentAvatarStyle,
	CENTER_AGENT_BOT_TYPES,
	defaultCenterAgentAvatar,
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
	const current =
		input.avatarStyle ??
		(input.centerAgent
			? defaultCenterAgentAvatar(input.profileId)
			: "automatic");
	const choices: readonly AgentAvatarStyle[] = input.centerAgent
		? [...CENTER_AGENT_BOT_TYPES, "fluid"]
		: ["automatic", "fluid"];
	const [candidate, setCandidate] = useState<AgentAvatarStyle>(current);
	const [open, setOpen] = useState(false);
	const size = input.size ?? 64;
	useEffect(() => {
		setCandidate(current);
	}, [current]);
	const changed = candidate !== current;
	const rotate = (step: number) => {
		const index = choices.indexOf(candidate);
		setCandidate(choices[(index + step + choices.length) % choices.length]);
		setOpen(true);
	};
	return (
		<div
			className="group/avatar-editor relative shrink-0"
			style={{ width: size, height: size }}
		>
			<RemoteAgentAvatar
				avatarStyle={candidate}
				clickable
				modelId={input.modelId}
				profileId={input.profileId}
				profileName={input.profileName}
				shape={input.centerAgent ? "circle" : "rounded-square"}
				size={size}
			/>
			{input.canEdit ? (
				<>
					<button
						aria-label="Previous avatar"
						className={`absolute top-1/2 left-0 z-10 grid size-6 -translate-y-1/2 place-items-center rounded-full bg-background/85 text-foreground shadow-sm transition-opacity focus-visible:outline-2 focus-visible:outline-ring ${open ? "opacity-100" : "opacity-0 group-focus-within/avatar-editor:opacity-100 group-hover/avatar-editor:opacity-100"}`}
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
						className={`absolute top-1/2 right-0 z-10 grid size-6 -translate-y-1/2 place-items-center rounded-full bg-background/85 text-foreground shadow-sm transition-opacity focus-visible:outline-2 focus-visible:outline-ring ${open ? "opacity-100" : "opacity-0 group-focus-within/avatar-editor:opacity-100 group-hover/avatar-editor:opacity-100"}`}
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
					{changed ? (
						<AvatarAction
							aria-label="Save avatar"
							disabled={input.saving}
							onClick={async (event) => {
								event.stopPropagation();
								try {
									await input.onSave(candidate);
									setOpen(false);
								} catch {
									// The caller reports the save error; retain the candidate for retry.
								}
							}}
						>
							<CheckIcon aria-hidden="true" weight="bold" />
						</AvatarAction>
					) : null}
				</>
			) : null}
		</div>
	);
}
