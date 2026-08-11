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
import { useState } from "react";

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
	const [saveFailed, setSaveFailed] = useState(false);
	const blocker = useBlocker({
		disabled: !input.hasUnsavedChanges,
		enableBeforeUnload: input.hasUnsavedChanges,
		shouldBlockFn: () => true,
		withResolver: true,
	});
	const open = blocker.status === "blocked";

	return (
		<Dialog
			onOpenChange={(nextOpen) => {
				if (!nextOpen && blocker.status === "blocked" && !input.saving) {
					setSaveFailed(false);
					blocker.reset();
				}
			}}
			open={open}
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
					<Button
						disabled={input.saving}
						onClick={() => {
							setSaveFailed(false);
							blocker.status === "blocked" && blocker.reset();
						}}
						variant="outline"
					>
						Cancel
					</Button>
					<Button
						disabled={input.saving}
						onClick={() => {
							setSaveFailed(false);
							blocker.status === "blocked" && blocker.proceed();
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
								.onSave()
								.then((saved) => {
									if (saved && blocker.status === "blocked") {
										blocker.proceed();
										return;
									}
									setSaveFailed(true);
								})
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
