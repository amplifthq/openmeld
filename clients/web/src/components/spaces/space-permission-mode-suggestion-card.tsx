import type { PermissionModeSuggestion } from "@openmeld/schemas";
import {
	ApprovalCard,
	ApprovalCardBody,
	ApprovalCardFooter,
	ApprovalCardHeader,
} from "@openmeld/ui/components/approval-card";
import { Button } from "@openmeld/ui/components/button";
import { ShieldCheckIcon } from "@phosphor-icons/react";
import { useState } from "react";
import type {
	SpaceAgentPermissionModeOption,
	SpaceAgentPermissionModeUpdateHandler,
} from "./space-agent-interaction-card";

export type PermissionModeSuggestionResolveHandler = (input: {
	resolution: "applied" | "dismissed";
	suggestionId: string;
}) => Promise<unknown>;

/**
 * Owner-only card for the permission-mode advisor. Apply saves the mode
 * through the owner's existing permission-mode write; the card never
 * changes a setting by itself.
 */
export function SpacePermissionModeSuggestionCard(input: {
	onPermissionModeUpdate: SpaceAgentPermissionModeUpdateHandler;
	onResolve: PermissionModeSuggestionResolveHandler;
	onSubmitFailed: (failure: { errorMessage: string }) => void;
	onSubmitStarted: () => void;
	restoredFailure?: { errorMessage: string };
	suggestedOption: SpaceAgentPermissionModeOption;
	suggestion: PermissionModeSuggestion;
}) {
	const [pending, setPending] = useState(false);
	const submit = async (resolution: "applied" | "dismissed") => {
		setPending(true);
		input.onSubmitStarted();
		try {
			// Close the card first, so a card already handled elsewhere never
			// changes a setting. Apply then uses the owner's existing write.
			await input.onResolve({
				resolution,
				suggestionId: input.suggestion.suggestionId,
			});
			if (resolution === "applied") {
				await input.onPermissionModeUpdate({
					permissionMode: input.suggestion.suggestedPermissionMode,
					profileId: input.suggestion.agentProfileId,
				});
			}
		} catch (error) {
			input.onSubmitFailed({
				errorMessage:
					error instanceof Error
						? error.message
						: "Couldn't save this choice. Try again.",
			});
		} finally {
			setPending(false);
		}
	};
	const count = input.suggestion.waitingApprovalCount;
	return (
		<ApprovalCard data-slot="space-permission-mode-suggestion-card">
			<ApprovalCardHeader
				description="Suggested by your Agent"
				icon={<ShieldCheckIcon aria-hidden="true" />}
				title={`Switch to ${input.suggestedOption.label}?`}
			/>
			<ApprovalCardBody className="space-y-1 text-sm">
				<p>
					Other people's tasks waited for your approval{" "}
					{count === 1 ? "once" : `${count} times`} this week.
				</p>
				<p className="text-muted-foreground">
					{input.suggestedOption.description}
				</p>
				{input.restoredFailure ? (
					<p className="text-destructive" role="alert">
						{input.restoredFailure.errorMessage}
					</p>
				) : null}
			</ApprovalCardBody>
			<ApprovalCardFooter>
				<Button
					disabled={pending}
					onClick={() => submit("applied")}
					size="sm"
					type="button"
				>
					Apply
				</Button>
				<Button
					disabled={pending}
					onClick={() => submit("dismissed")}
					size="sm"
					type="button"
					variant="outline"
				>
					Not now
				</Button>
			</ApprovalCardFooter>
		</ApprovalCard>
	);
}
