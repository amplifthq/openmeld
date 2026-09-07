"use client";

import type { LocalProjectControlConnection } from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@openmeld/ui/components/dialog";
import { SelectedLocalFolder } from "#/components/local-runtimes/selected-local-folder";

export function ProjectDefaultFolderDialog(input: {
	connection: LocalProjectControlConnection | null;
	projectName: string;
	pending: boolean;
	errorMessage: string | null;
	onCancel: () => void;
	onConfirm: (connection: LocalProjectControlConnection) => Promise<void>;
}) {
	return (
		<Dialog
			onOpenChange={(open) => {
				if (!(open || input.pending)) {
					input.onCancel();
				}
			}}
			open={input.connection !== null}
		>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>Change this project’s default folder?</DialogTitle>
					<DialogDescription>
						New sessions for every agent using {input.projectName} on this
						computer will use this folder. Current sessions stay where they are.
					</DialogDescription>
				</DialogHeader>
				{input.connection ? (
					<SelectedLocalFolder path={input.connection.path} />
				) : null}
				{input.errorMessage ? (
					<p className="text-destructive text-sm" role="alert">
						{input.errorMessage}
					</p>
				) : null}
				<DialogFooter>
					<Button
						disabled={input.pending}
						onClick={input.onCancel}
						variant="ghost"
					>
						Cancel
					</Button>
					<Button
						disabled={input.pending}
						onClick={() => {
							if (input.connection) {
								return input.onConfirm(input.connection);
							}
						}}
					>
						{input.pending ? "Saving…" : "Change default folder"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
