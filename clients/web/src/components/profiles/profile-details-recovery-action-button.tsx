"use client";

import type { ProfileDetailsRecoveryAction } from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";

export function ProfileDetailsRecoveryActionButton(input: {
	compact?: boolean;
	isPending: boolean;
	onRecoveryAction: (recoveryAction: ProfileDetailsRecoveryAction) => void;
	recoveryAction: ProfileDetailsRecoveryAction;
}) {
	return (
		<Button
			disabled={input.isPending}
			onClick={() => input.onRecoveryAction(input.recoveryAction)}
			size={input.compact ? "xs" : "sm"}
			type="button"
			variant="outline"
		>
			{input.isPending
				? formatProfileDetailsRecoveryActionPendingLabel(
						input.recoveryAction,
						input.compact
					)
				: formatProfileDetailsRecoveryActionLabel(
						input.recoveryAction,
						input.compact
					)}
		</Button>
	);
}

function formatProfileDetailsRecoveryActionPendingLabel(
	recoveryAction: ProfileDetailsRecoveryAction,
	compact = false
): string {
	switch (recoveryAction.kind) {
		case "continue_interrupted_work":
			return compact ? "Continuing…" : "Continuing interrupted work…";
		case "approve_queued_work":
			return compact ? "Starting…" : "Starting queued work…";
		case "skip_interrupted_work":
			return compact ? "Skipping…" : "Skipping interrupted work…";
		default:
			return assertNeverProfileDetailsRecoveryActionKind(recoveryAction.kind);
	}
}

function formatProfileDetailsRecoveryActionLabel(
	recoveryAction: ProfileDetailsRecoveryAction,
	compact = false
): string {
	switch (recoveryAction.kind) {
		case "continue_interrupted_work":
			return compact ? "Continue" : "Continue interrupted work";
		case "approve_queued_work":
			return compact ? "Start" : "Start queued work";
		case "skip_interrupted_work":
			return compact ? "Skip" : "Skip interrupted work";
		default:
			return assertNeverProfileDetailsRecoveryActionKind(recoveryAction.kind);
	}
}

function assertNeverProfileDetailsRecoveryActionKind(value: never): never {
	throw new Error(
		`Unsupported Agent Profile recovery action: ${String(value)}`
	);
}
