"use client";

import type { SpaceMentionSuggestion } from "@openmeld/space";
import { UsersIcon } from "@phosphor-icons/react";
import { useEditorRef } from "platejs/react";
import { useState } from "react";
import {
	InlineComboboxGroup,
	InlineComboboxGroupLabel,
	InlineComboboxItem,
} from "#/components/editor/ui/inline-combobox";
import {
	buildSpaceAudienceMentions,
	type SpaceMentionAudience,
} from "./space-composer-all-mentions";
import { isSpaceComposerProfileElement } from "./space-composer-editor-model";

const AUDIENCES: readonly {
	label: string;
	action: string;
	value: SpaceMentionAudience;
}[] = [
	{ label: "People", action: "Notify", value: "people" },
	{ label: "Agents", action: "Wake", value: "agents" },
	{ label: "Both", action: "Notify + Wake", value: "both" },
];

export function SpaceComposerAllMentionOptions({
	suggestions,
}: {
	suggestions: readonly SpaceMentionSuggestion[];
}) {
	const editor = useEditorRef();
	const [choosingAudience, setChoosingAudience] = useState(false);
	if (suggestions.length === 0) {
		return null;
	}
	if (!choosingAudience) {
		return (
			<InlineComboboxItem
				hideOnClick={false}
				keywords={["all", "everyone"]}
				onClick={() => setChoosingAudience(true)}
				removeInputOnSelect={false}
				setValueOnClick={false}
				value="all"
			>
				<UsersIcon className="mr-2" />
				<span className="flex-1 font-medium">@all</span>
			</InlineComboboxItem>
		);
	}
	return (
		<InlineComboboxGroup>
			<InlineComboboxGroupLabel>@all</InlineComboboxGroupLabel>
			{AUDIENCES.map(({ label, action, value }) => {
				const mentions = buildSpaceAudienceMentions({
					audience: value,
					suggestions,
				});
				const audienceMention = mentions[0];
				const targetIds = new Set(
					audienceMention?.audienceTargets?.map((target) => target.profileId)
				);
				return (
					<InlineComboboxItem
						disabled={!audienceMention}
						key={value}
						keywords={["all", "everyone"]}
						onClick={() => {
							if (!audienceMention) {
								return;
							}
							editor.tf.withoutNormalizing(() => {
								const existingPaths = Array.from(
									editor.api.nodes({
										at: [],
										match: (node) =>
											isSpaceComposerProfileElement(node) &&
											(node.audienceTargets?.some((target) =>
												targetIds.has(target.profileId)
											) ||
												targetIds.has(node.profileId)),
									})
								).map((entry) => entry[1]);
								for (const path of existingPaths.reverse()) {
									editor.tf.removeNodes({ at: path });
								}
								editor.tf.insertNodes(audienceMention);
								editor.tf.move({ unit: "offset" });
								editor.tf.insertText(" ");
							});
						}}
						value={label}
					>
						<span className="flex-1">{label}</span>
						<span className="text-muted-foreground text-xs">
							{action} · {audienceMention?.audienceTargets?.length ?? 0}
						</span>
					</InlineComboboxItem>
				);
			})}
		</InlineComboboxGroup>
	);
}
