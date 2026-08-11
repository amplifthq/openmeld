"use client";

import type { LocalProjectControlPathConflictResponse } from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@openmeld/ui/components/dialog";
import { resolveStatusToneStrongTextClassName } from "@openmeld/ui/lib/status-tone";

export function FolderMoveConfirmationDialog(input: {
	conflict: LocalProjectControlPathConflictResponse | null;
	errorMessage: string | null;
	onConfirm: () => void;
	onOpenChange: (open: boolean) => void;
	open: boolean;
	pending: boolean;
	projectName: string;
}) {
	if (!input.conflict) {
		return null;
	}
	const currentScope =
		input.conflict.conflictScope === "another_organization"
			? "another Organization"
			: "this Organization";
	const description = `This folder is currently connected to the “${input.conflict.conflictingProjectSlug}” Project in ${currentScope}. Moving it here disconnects it there.`;
	return (
		<Dialog onOpenChange={input.onOpenChange} open={input.open}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Move this folder to {input.projectName}?</DialogTitle>
					<DialogDescription>{description}</DialogDescription>
				</DialogHeader>
				<p className="rounded-md border p-3 text-sm leading-6">
					{resolveFolderMoveImpactMessage(input.conflict.moveImpact)}
				</p>
				{input.errorMessage ? (
					<p
						className={resolveStatusToneStrongTextClassName("danger")}
						role="alert"
					>
						{input.errorMessage}
					</p>
				) : null}
				<DialogFooter>
					<Button
						disabled={input.pending}
						onClick={() => input.onOpenChange(false)}
						variant="outline"
					>
						Keep current connection
					</Button>
					<Button disabled={input.pending} onClick={input.onConfirm}>
						Move folder
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function resolveFolderMoveImpactMessage(
	impact: LocalProjectControlPathConflictResponse["moveImpact"]
): string {
	switch (impact) {
		case "only_connection":
			return "Agents using that Project on this computer won’t be able to start until another folder is connected.";
		case "default_connection":
			return "OpenMeld will make another connected folder the default for that Project.";
		case "additional_connection":
			return "That Project’s default folder won’t change.";
		default: {
			const exhaustive: never = impact;
			return exhaustive;
		}
	}
}
