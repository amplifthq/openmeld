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
 * One navigation contract for directly editable Web surfaces. Internal
 * navigation gets an actionable dialog; refresh, close, and external
 * navigation use the browser's native before-unload warning.
 */
export function UnsavedChangesGuard(input: {
	description: string;
	hasUnsavedChanges: boolean;
	onSave: () => Promise<boolean>;
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
				blocker.status === "blocked" && blocker.proceed();
			}}
			onSaveAndLeave={async () => {
				const saved = await input.onSave();
				if (saved && blocker.status === "blocked") {
					blocker.proceed();
				}
				return saved;
			}}
			open={open}
			saving={input.saving}
		/>
	);
}

/** The shared leave-confirmation experience for route and in-surface exits. */
export function UnsavedChangesDialog(input: {
	description: string;
	onCancel: () => void;
	onDiscard: () => void;
	onSaveAndLeave: () => Promise<boolean>;
	open: boolean;
	saving?: boolean;
}) {
	const [saveFailed, setSaveFailed] = useState(false);
	const cancel = () => {
		setSaveFailed(false);
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
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Save changes before leaving?</DialogTitle>
					<DialogDescription>{input.description}</DialogDescription>
				</DialogHeader>
				{saveFailed ? (
					<p className="text-destructive text-sm" role="alert">
						OpenMeld couldn't save your changes. Fix the error and try again.
					</p>
				) : null}
				<DialogFooter>
					<Button disabled={input.saving} onClick={cancel} variant="outline">
						Cancel
					</Button>
					<Button
						disabled={input.saving}
						onClick={() => {
							setSaveFailed(false);
							input.onDiscard();
						}}
						variant="outline"
					>
						Discard changes
					</Button>
					<Button
						disabled={input.saving}
						onClick={() => {
							setSaveFailed(false);
							input
								.onSaveAndLeave()
								.then((saved) => setSaveFailed(!saved))
								.catch((error: unknown) => {
									console.error(
										"Failed to save before leaving the page.",
										error
									);
									setSaveFailed(true);
								});
						}}
					>
						{input.saving ? "Saving…" : "Save and leave"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
