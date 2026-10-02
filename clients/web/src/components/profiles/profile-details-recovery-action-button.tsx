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

type ProfileDetailsRecoveryActionButtonProps = {
	compact?: boolean;
	isPending: boolean;
	onRecoveryAction: (recoveryAction: ProfileDetailsRecoveryAction) => void;
	recoveryAction: ProfileDetailsRecoveryAction;
};

export function ProfileDetailsRecoveryActionButton(
	input: ProfileDetailsRecoveryActionButtonProps
) {
	return (
		<RecoveryActionButton
			{...input}
			key={`${input.recoveryAction.kind}:${input.recoveryAction.expectedInterruptedTargetWakeLifecycleId ?? "unknown"}`}
		/>
	);
}

function RecoveryActionButton(input: ProfileDetailsRecoveryActionButtonProps) {
	const [isSkipConfirmationOpen, setIsSkipConfirmationOpen] = useState(false);
	const [isForkConfirmationOpen, setIsForkConfirmationOpen] = useState(false);
	const buttonLabel = input.isPending
		? formatProfileDetailsRecoveryActionPendingLabel(
				input.recoveryAction,
				input.compact
			)
		: formatProfileDetailsRecoveryActionLabel(
				input.recoveryAction,
				input.compact
			);

	if (input.recoveryAction.kind === "fork_interrupted_work") {
		const recoveryAction = input.recoveryAction;
		return (
			<AlertDialog
				onOpenChange={(open) => {
					if (!input.isPending) {
						setIsForkConfirmationOpen(open);
					}
				}}
				open={isForkConfirmationOpen}
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
						<AlertDialogTitle>
							Another app is using this conversation
						</AlertDialogTitle>
						<AlertDialogDescription>
							OpenMeld cannot write to it while the other app has it open. It
							can continue on a new branch, copying the conversation up to the
							last completed reply it can verify. The other app keeps the
							original, and the two do not merge back together. A new branch
							copies the conversation only: files and anything the work already
							changed outside OpenMeld stay shared.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={input.isPending}>
							Cancel
						</AlertDialogCancel>
						<AlertDialogAction
							disabled={input.isPending}
							onClick={() => {
								setIsForkConfirmationOpen(false);
								input.onRecoveryAction({
									...recoveryAction,
									kind: "skip_interrupted_work",
								});
							}}
							type="button"
							variant="destructive"
						>
							Skip work
						</AlertDialogAction>
						<AlertDialogAction
							disabled={input.isPending}
							onClick={() => {
								setIsForkConfirmationOpen(false);
								input.onRecoveryAction(recoveryAction);
							}}
							type="button"
						>
							Continue on a new branch
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		);
	}

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
							OpenMeld will not continue this work, and it asks your computer to
							stop the original attempt. Anything the work already changed stays
							as it is. Any queued work can start after you skip it.
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
		case "fork_interrupted_work":
			return compact ? "Continuing…" : "Continuing on a new branch…";
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
		case "fork_interrupted_work":
			return compact ? "Choose" : "Choose how to continue";
		default:
			return assertNeverProfileDetailsRecoveryActionKind(recoveryAction.kind);
	}
}

function assertNeverProfileDetailsRecoveryActionKind(value: never): never {
	throw new Error(
		`Unsupported Agent Profile recovery action: ${String(value)}`
	);
}
