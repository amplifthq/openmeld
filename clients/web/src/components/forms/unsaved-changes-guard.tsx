"use client";

import { Button } from "@openmeld/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@openmeld/ui/components/dialog";
import { useBlocker } from "@tanstack/react-router";
import { useLayoutEffect, useState } from "react";
import { registerClientVersionRecoveryBlocker } from "#/client-version-recovery";

/**
 * Existing callers return true when safe to leave, or false on failure.
 * A successful submission can instead retain newer unsaved input; that outcome
 * must keep navigation blocked without reporting the submission as failed.
 */
export type SaveBeforeLeaveResult = boolean | "saved-with-unsaved-changes";

/**
 * One navigation contract for directly editable Web surfaces. Internal
 * navigation gets an actionable dialog; refresh, close, and external
 * navigation use the browser's native before-unload warning.
 */
export function UnsavedChangesGuard(input: {
	description: string;
	hasUnsavedChanges: boolean;
	/** Omit for creation/import drafts that cannot be saved without committing. */
	onSave?: () => Promise<SaveBeforeLeaveResult>;
	onDiscard?: () => void;
	title?: string;
	saving?: boolean;
}) {
	useLayoutEffect(
		() => registerClientVersionRecoveryBlocker(() => input.hasUnsavedChanges),
		[input.hasUnsavedChanges]
	);
	const blocker = useBlocker({
		disabled: !input.hasUnsavedChanges,
		enableBeforeUnload: input.hasUnsavedChanges,
		shouldBlockFn: () => true,
		withResolver: true,
	});
	const open = blocker.status === "blocked";

	return (
		<UnsavedChangesDialog
			description={input.description}
			onCancel={() => {
				blocker.status === "blocked" && blocker.reset();
			}}
			onDiscard={() => {
				input.onDiscard?.();
				blocker.status === "blocked" && blocker.proceed();
			}}
			onSaveAndLeave={
				input.onSave
					? async () => {
							const saved = await input.onSave?.();
							if (saved === true && blocker.status === "blocked") {
								blocker.proceed();
							}
							return saved ?? false;
						}
					: undefined
			}
			open={open}
			saving={input.saving}
			title={input.title}
		/>
	);
}

/** The shared leave-confirmation experience for route and in-surface exits. */
export function UnsavedChangesDialog(input: {
	description: string;
	onCancel: () => void;
	onDiscard: () => void;
	onSaveAndLeave?: () => Promise<SaveBeforeLeaveResult>;
	title?: string;
	open: boolean;
	saving?: boolean;
}) {
	const [saveResult, setSaveResult] = useState<SaveBeforeLeaveResult | null>(
		null
	);
	const cancel = () => {
		setSaveResult(null);
		input.onCancel();
	};

	return (
		<Dialog
			onOpenChange={(nextOpen) => {
				if (!(nextOpen || input.saving)) {
					cancel();
				}
			}}
			open={input.open}
		>
			<DialogContent showCloseButton={!input.saving}>
				<DialogHeader>
					<DialogTitle>
						{input.title ??
							(input.onSaveAndLeave
								? "Save changes before leaving?"
								: "Discard unsaved changes?")}
					</DialogTitle>
					<DialogDescription>{input.description}</DialogDescription>
				</DialogHeader>
				{saveResult === false ? (
					<p className="text-destructive text-sm" role="alert">
						OpenMeld couldn't save your changes. Fix the error and try again.
					</p>
				) : null}
				{saveResult === "saved-with-unsaved-changes" ? (
					<output className="block text-muted-foreground text-sm">
						Your previous changes were saved, but you have newer unsaved
						changes. Save again before leaving.
					</output>
				) : null}
				<DialogFooter>
					<Button disabled={input.saving} onClick={cancel} variant="outline">
						Cancel
					</Button>
					<Button
						disabled={input.saving}
						onClick={() => {
							setSaveResult(null);
							input.onDiscard();
						}}
						variant="outline"
					>
						Discard changes
					</Button>
					{input.onSaveAndLeave && (
						<Button
							disabled={input.saving}
							onClick={() => {
								setSaveResult(null);
								input
									.onSaveAndLeave?.()
									.then((result) => setSaveResult(result))
									.catch((error: unknown) => {
										console.error(
											"Failed to save before leaving the page.",
											error
										);
										setSaveResult(false);
									});
							}}
						>
							{input.saving ? "Saving…" : "Save and leave"}
						</Button>
					)}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
