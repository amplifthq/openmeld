import type { MessageMentionType } from "@openmeld/schemas";
import { listSpaceMentionRelationChoices } from "@openmeld/space";
import { LinkIcon } from "@phosphor-icons/react";
import type { SpaceComposerAddressingTarget } from "./use-space-mention-authoring";

export function SpaceComposerAddressingChips(input: {
	onRelationChange: (profileId: string, relation: MessageMentionType) => void;
	targets: readonly SpaceComposerAddressingTarget[];
}) {
	if (input.targets.length === 0) {
		return null;
	}

	return (
		<fieldset className="flex flex-wrap items-center gap-1.5 px-1 pb-2">
			<legend className="sr-only">Message addressing</legend>
			{input.targets.map((target) => {
				const choices = listSpaceMentionRelationChoices({
					allowedRelations: target.allowedRelations,
					primaryMentionLabel: target.profileName,
					wakeAvailability: target.wakeAvailability,
				});
				return (
					<div
						className="inline-flex h-7 items-center gap-1.5 border border-border bg-muted/50 px-2 text-xs"
						key={target.profileId}
					>
						<SpaceMentionRelationSymbol relation={target.relation} />
						<span className="max-w-32 truncate font-medium">
							{target.profileName}
						</span>
						<select
							aria-label={`Change relation for ${target.profileName}`}
							className="min-w-0 bg-transparent font-medium text-muted-foreground text-xs outline-none"
							onChange={(event) => {
								input.onRelationChange(
									target.profileId,
									event.target.value as MessageMentionType
								);
							}}
							value={target.relation}
						>
							{choices.map((choice) => (
								<option key={choice.relation} value={choice.relation}>
									{choice.label}
								</option>
							))}
						</select>
					</div>
				);
			})}
		</fieldset>
	);
}

export function SpaceMentionRelationSymbol(input: {
	relation: MessageMentionType;
}) {
	if (input.relation === "wake") {
		return (
			<span aria-hidden="true" className="font-bold">
				@
			</span>
		);
	}
	if (input.relation === "reference") {
		return <LinkIcon aria-hidden="true" className="size-3" />;
	}
	return null;
}
