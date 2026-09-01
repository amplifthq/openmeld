"use client";

import type { ProfileDetailsRecoveryAction } from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";

export function ProfileDetailsRecoveryActionButton(input: {
	isPending: boolean;
	onRecoveryAction: (recoveryAction: ProfileDetailsRecoveryAction) => void;
	recoveryAction: ProfileDetailsRecoveryAction;
}) {
	return (
		<Button
			disabled={input.isPending}
			onClick={() => input.onRecoveryAction(input.recoveryAction)}
			size="sm"
			type="button"
			variant="outline"
		>
			{input.isPending
				? formatProfileDetailsRecoveryActionPendingLabel(input.recoveryAction)
				: formatProfileDetailsRecoveryActionLabel(input.recoveryAction)}
		</Button>
	);
}

function formatProfileDetailsRecoveryActionPendingLabel(
	recoveryAction: ProfileDetailsRecoveryAction
): string {
	switch (recoveryAction.kind) {
		case "continue_interrupted_work":
			return "Continuing interrupted work…";
		case "approve_queued_work":
			return "Starting queued work…";
		case "skip_interrupted_work":
			return "Skipping interrupted work…";
		default:
			return assertNeverProfileDetailsRecoveryActionKind(recoveryAction.kind);
	}
}

function formatProfileDetailsRecoveryActionLabel(
	recoveryAction: ProfileDetailsRecoveryAction
): string {
	switch (recoveryAction.kind) {
		case "continue_interrupted_work":
			return "Continue interrupted work";
		case "approve_queued_work":
			return "Start queued work";
		case "skip_interrupted_work":
			return "Skip interrupted work";
		default:
			return assertNeverProfileDetailsRecoveryActionKind(recoveryAction.kind);
	}
}

function assertNeverProfileDetailsRecoveryActionKind(value: never): never {
	throw new Error(
		`Unsupported Agent Profile recovery action: ${String(value)}`
	);
}
