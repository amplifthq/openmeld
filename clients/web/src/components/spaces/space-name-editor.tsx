"use client";

import { MAX_SPACE_NAME_LENGTH, spaceNameSchema } from "@openmeld/schemas";
import { Button } from "@openmeld/ui/components/button";
import { Input } from "@openmeld/ui/components/input";
import { Label } from "@openmeld/ui/components/label";
import { type FormEvent, useId, useState } from "react";

export function SpaceNameEditor(input: {
	currentName: string;
	errorMessage: string | null;
	isPending: boolean;
	onSave: (name: string) => Promise<void>;
}) {
	const nameInputId = useId();
	const [nameDraft, setNameDraft] = useState<{
		sourceName: string;
		value: string;
	} | null>(null);
	const name =
		nameDraft?.sourceName === input.currentName
			? nameDraft.value
			: input.currentName;
	const parsedName = spaceNameSchema.safeParse(name);
	const canSubmit =
		parsedName.success &&
		parsedName.data !== input.currentName &&
		!input.isPending;

	const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (!(canSubmit && parsedName.success)) {
			return;
		}
		await input.onSave(parsedName.data);
	};

	return (
		<form className="min-w-0 space-y-2" onSubmit={handleSubmit}>
			<Label className="text-muted-foreground text-xs" htmlFor={nameInputId}>
				Space name
			</Label>
			<div className="flex min-w-0 flex-col gap-2 sm:flex-row">
				<Input
					autoComplete="off"
					className="min-w-0 flex-1"
					disabled={input.isPending}
					id={nameInputId}
					maxLength={MAX_SPACE_NAME_LENGTH}
					onChange={(event) => {
						setNameDraft({
							sourceName: input.currentName,
							value: event.target.value,
						});
					}}
					value={name}
				/>
				<Button disabled={!canSubmit} type="submit">
					{input.isPending ? "Saving..." : "Save name"}
				</Button>
			</div>
			<p className="text-muted-foreground text-xs">
				Use a clear name people can recognize. Up to {MAX_SPACE_NAME_LENGTH}
				characters.
			</p>
			{input.errorMessage ? (
				<p className="text-destructive text-xs" role="alert">
					{input.errorMessage}
				</p>
			) : null}
		</form>
	);
}
