import type { CreateSpaceTaskBody } from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogTitle,
} from "@openmeld/ui/components/dialog";
import { Textarea } from "@openmeld/ui/components/textarea";
import { useState } from "react";
import {
	type SpaceTaskDraft,
	SpaceTaskDraftFields,
	type TaskDraftMember,
} from "./space-task-draft-fields";
export function SpaceTaskCreateDialog({
	members,
	onCreate,
	onClose,
}: {
	members: readonly TaskDraftMember[];
	onCreate: (body: CreateSpaceTaskBody) => Promise<boolean>;
	onClose: () => void;
}) {
	const [draft, setDraft] = useState<SpaceTaskDraft>({ title: "" });
	const [description, setDescription] = useState("");
	const [creating, setCreating] = useState(false);
	const [operationId] = useState(() => crypto.randomUUID());
	return (
		<Dialog
			onOpenChange={(open) => {
				if (!(open || creating)) {
					onClose();
				}
			}}
			open
		>
			<DialogContent
				aria-describedby={undefined}
				className="sm:max-w-lg"
				showCloseButton={!creating}
			>
				<DialogTitle>New task</DialogTitle>
				<form
					className="space-y-5"
					onSubmit={async (event) => {
						event.preventDefault();
						if (creating || !draft.title.trim()) {
							return;
						}
						setCreating(true);
						const created = await onCreate({
							...draft,
							operationId,
							description: description.trim() || null,
						});
						setCreating(false);
						if (created) {
							onClose();
						}
					}}
				>
					<SpaceTaskDraftFields
						disabled={creating}
						draft={draft}
						members={members}
						onChange={setDraft}
					>
						<div>
							<label
								className="text-muted-foreground text-xs"
								htmlFor="task-description"
							>
								Description
							</label>
							<Textarea
								className="mt-1"
								disabled={creating}
								id="task-description"
								maxLength={8000}
								onChange={(event) => setDescription(event.target.value)}
								value={description}
							/>
						</div>
					</SpaceTaskDraftFields>
					<DialogFooter>
						<Button
							disabled={creating}
							onClick={onClose}
							size="sm"
							type="button"
							variant="ghost"
						>
							Cancel
						</Button>
						<Button
							disabled={creating || !draft.title.trim()}
							size="sm"
							type="submit"
						>
							Create task
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
