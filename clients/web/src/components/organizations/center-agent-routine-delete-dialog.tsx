"use client";

import type { CenterAgentRoutine } from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@openmeld/ui/components/dialog";

export function CenterAgentRoutineDeleteDialog(input: {
	errorMessage: string | null;
	onConfirm: () => void;
	onOpenChange: (open: boolean) => void;
	open: boolean;
	routine: CenterAgentRoutine | null;
	submitting: boolean;
}) {
	const routineName = input.routine?.name ?? "routine";
	return (
		<Dialog onOpenChange={input.onOpenChange} open={input.open}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Delete {routineName}?</DialogTitle>
					<DialogDescription>
						This deletes the routine definition and stops future runs.
					</DialogDescription>
				</DialogHeader>
				<p className="text-muted-foreground text-sm">
					Existing run history is retained for audit.
				</p>
				{input.errorMessage ? (
					<p className="break-words text-destructive text-sm" role="alert">
						{input.errorMessage}
					</p>
				) : null}
				<DialogFooter>
					<Button
						disabled={input.submitting}
						onClick={() => input.onOpenChange(false)}
						type="button"
						variant="outline"
					>
						Cancel
					</Button>
					<Button
						disabled={input.submitting || !input.routine}
						onClick={input.onConfirm}
						type="button"
						variant="destructive"
					>
						{input.submitting ? "Deleting" : "Delete routine"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
