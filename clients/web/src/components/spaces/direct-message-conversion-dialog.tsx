"use client";

import { MAX_SPACE_NAME_LENGTH } from "@openmeld/schemas";
import { Button } from "@openmeld/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@openmeld/ui/components/dialog";
import { Input } from "@openmeld/ui/components/input";
import { useEffect, useId, useState } from "react";
import { formatDirectMessageConversionNames } from "./direct-message-conversion";

export function DirectMessageConversionDialog(input: {
	defaultName: string;
	isPending: boolean;
	onConfirm: (name: string) => Promise<void>;
	onOpenChange: (open: boolean) => void;
	open: boolean;
	selectedNames: readonly string[];
}) {
	const nameId = useId();
	const [name, setName] = useState(input.defaultName);

	useEffect(() => {
		if (input.open) {
			setName(input.defaultName);
		}
	}, [input.defaultName, input.open]);

	const normalizedName = name.trim();
	const canConfirm =
		!input.isPending &&
		normalizedName.length > 0 &&
		normalizedName.length <= MAX_SPACE_NAME_LENGTH;
	const selectedNames = formatDirectMessageConversionNames(input.selectedNames);

	return (
		<Dialog
			onOpenChange={(open) => {
				if (!input.isPending) {
					input.onOpenChange(open);
				}
			}}
			open={input.open}
		>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>Turn this Direct Message into a Space?</DialogTitle>
					<DialogDescription>
						Adding {selectedNames} will move this conversation to Spaces.
						Everyone in the new Space will be able to see its existing messages
						and files. This cannot be undone.
					</DialogDescription>
				</DialogHeader>
				<div className="grid gap-2 py-2">
					<label className="font-medium text-sm" htmlFor={nameId}>
						Space name
					</label>
					<Input
						autoFocus
						disabled={input.isPending}
						id={nameId}
						maxLength={MAX_SPACE_NAME_LENGTH}
						onChange={(event) => setName(event.target.value)}
						value={name}
					/>
				</div>
				<DialogFooter>
					<Button
						disabled={input.isPending}
						onClick={() => input.onOpenChange(false)}
						type="button"
						variant="outline"
					>
						Cancel
					</Button>
					<Button
						disabled={!canConfirm}
						onClick={() => input.onConfirm(normalizedName)}
						type="button"
					>
						{input.isPending ? "Turning into a Space…" : "Turn into a Space"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
