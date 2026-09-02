"use client";

import type { ProfileDetailsRecoveryAction } from "@openmeld/schemas/types";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@openmeld/ui/components/alert-dialog";
import { Button } from "@openmeld/ui/components/button";
import { useState } from "react";

export function ProfileDetailsRecoveryActionButton(input: {
	compact?: boolean;
	isPending: boolean;
	onRecoveryAction: (recoveryAction: ProfileDetailsRecoveryAction) => void;
	recoveryAction: ProfileDetailsRecoveryAction;
}) {
	const [isSkipConfirmationOpen, setIsSkipConfirmationOpen] = useState(false);
	const buttonLabel = input.isPending
		? formatProfileDetailsRecoveryActionPendingLabel(
				input.recoveryAction,
				input.compact
			)
		: formatProfileDetailsRecoveryActionLabel(
				input.recoveryAction,
				input.compact
			);

	if (input.recoveryAction.kind === "skip_interrupted_work") {
		return (
			<AlertDialog
				onOpenChange={(open) => {
					if (!input.isPending) {
						setIsSkipConfirmationOpen(open);
					}
				}}
				open={isSkipConfirmationOpen}
			>
				<AlertDialogTrigger
					render={
						<Button
							disabled={input.isPending}
							size={input.compact ? "xs" : "sm"}
							type="button"
							variant="outline"
						/>
					}
				>
					{buttonLabel}
				</AlertDialogTrigger>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Skip this work?</AlertDialogTitle>
						<AlertDialogDescription>
							This work will not continue. Any queued work can start after you
							skip it.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={input.isPending}>
							Cancel
						</AlertDialogCancel>
						<AlertDialogAction
							disabled={input.isPending}
							onClick={() => {
								setIsSkipConfirmationOpen(false);
								input.onRecoveryAction(input.recoveryAction);
							}}
							type="button"
							variant="destructive"
						>
							Skip work
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		);
	}

	return (
		<Button
			disabled={input.isPending}
			onClick={() => input.onRecoveryAction(input.recoveryAction)}
			size={input.compact ? "xs" : "sm"}
			type="button"
			variant="outline"
		>
			{buttonLabel}
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
