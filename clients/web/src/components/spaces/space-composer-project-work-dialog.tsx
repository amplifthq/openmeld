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
import { useState } from "react";
import {
	type SelectedProjectWork,
	SpaceProjectRepositoryFields,
} from "./space-project-repository-fields";

export function SpaceComposerProjectWorkDialog(input: {
	initialProjectId?: string;
	onOpenChange: (open: boolean) => void;
	onSelect: (selection: SelectedProjectWork) => void;
	open: boolean;
	organizationId: string;
}) {
	const [selection, setSelection] = useState<SelectedProjectWork | null>(null);
	return (
		<Dialog onOpenChange={input.onOpenChange} open={input.open}>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>Choose Project and repository</DialogTitle>
					<DialogDescription>
						This task will use one repository. The Agent's computer must have a
						matching local Project connection.
					</DialogDescription>
				</DialogHeader>
				<SpaceProjectRepositoryFields
					initialProjectId={input.initialProjectId}
					onChange={setSelection}
					organizationId={input.organizationId}
				/>
				<DialogFooter>
					<Button
						onClick={() => input.onOpenChange(false)}
						type="button"
						variant="outline"
					>
						Cancel
					</Button>
					<Button
						disabled={!selection}
						onClick={() => {
							if (selection) {
								input.onSelect(selection);
								input.onOpenChange(false);
							}
						}}
						type="button"
					>
						Use for new task
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
