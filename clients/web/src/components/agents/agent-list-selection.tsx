import type { AuthProfileView } from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import {
	Dialog,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@openmeld/ui/components/dialog";
import { DialogContent } from "@openmeld/ui/fluid/dialog";
import { CheckSquareIcon, TrashIcon } from "@phosphor-icons/react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import type { AgentListItem } from "./agent-list-model";

export type AgentDeleteFailure = { profileId: string; message: string };
export type DeleteAgents = (
	profiles: readonly AuthProfileView[]
) => Promise<AgentDeleteFailure[]>;
export type AgentCardSelection = {
	checked: boolean;
	disabled: boolean;
	onChange: () => void;
};

export function useAgentListSelection(
	items: readonly AgentListItem[],
	onDelete: DeleteAgents | undefined,
	scope: string
) {
	const [selecting, setActive] = useState(false);
	const active = selecting && Boolean(onDelete);
	const [ids, setIds] = useState<ReadonlySet<string>>(new Set());
	const [selectionScope, setSelectionScope] = useState(scope);
	// Changing the result set clears selection before any destructive action.
	if (selectionScope !== scope) {
		setSelectionScope(scope);
		setIds(new Set());
	}
	const [confirm, setConfirm] = useState<readonly AuthProfileView[] | null>(
		null
	);
	const [pending, setPending] = useState(false);
	const running = useRef(false);
	const [failures, setFailures] = useState<AgentDeleteFailure[]>([]);
	const selected = items
		.filter((item) => ids.has(item.profile.openMeldProfileId))
		.map((item) => item.profile);
	const reset = () => {
		setIds(new Set());
		setFailures([]);
	};
	const cancel = () => {
		reset();
		setActive(false);
	};
	const remove = async () => {
		if (!(confirm && onDelete) || running.current) {
			return;
		}
		running.current = true;
		setPending(true);
		try {
			const result = await onDelete(confirm);
			const count = confirm.length - result.length;
			if (count) {
				toast.success(`${count} ${count === 1 ? "Agent" : "Agents"} deleted.`);
			}
			setFailures(result);
			setIds(new Set(result.map((failure) => failure.profileId)));
			if (result.length === 0) {
				setActive(false);
			}
			setConfirm(null);
		} catch (error) {
			setFailures(
				confirm.map((profile) => ({
					profileId: profile.openMeldProfileId,
					message:
						error instanceof Error
							? error.message
							: "Couldn’t delete this Agent. Try again.",
				}))
			);
			setConfirm(null);
		} finally {
			running.current = false;
			setPending(false);
		}
	};
	return {
		active,
		cancel,
		reset,
		card: (item: AgentListItem): AgentCardSelection | undefined =>
			active
				? {
						checked: ids.has(item.profile.openMeldProfileId),
						disabled: pending,
						onChange: () =>
							setIds((current) => {
								const next = new Set(current);
								if (next.has(item.profile.openMeldProfileId)) {
									next.delete(item.profile.openMeldProfileId);
								} else {
									next.add(item.profile.openMeldProfileId);
								}
								return next;
							}),
					}
				: undefined,
		trigger:
			onDelete && !active && items.length > 0 ? (
				<Button
					onClick={() => {
						reset();
						setActive(true);
					}}
					size="sm"
					variant="secondary"
				>
					<CheckSquareIcon />
					Select
				</Button>
			) : null,
		toolbar: active ? (
			<fieldset
				aria-label="Agent selection"
				className="flex flex-wrap items-center gap-2"
			>
				<output className="mr-auto text-sm">{selected.length} selected</output>
				<Button
					disabled={pending || items.length === 0}
					onClick={() =>
						setIds(
							selected.length === items.length
								? new Set()
								: new Set(items.map((item) => item.profile.openMeldProfileId))
						)
					}
					size="sm"
					variant="secondary"
				>
					{selected.length === items.length && items.length > 0
						? "Deselect all"
						: "Select visible"}
				</Button>
				<Button
					disabled={pending || selected.length === 0}
					onClick={() => setConfirm(selected)}
					size="sm"
					variant="destructive"
				>
					<TrashIcon />
					Delete{selected.length ? ` (${selected.length})` : ""}
				</Button>
				<Button
					disabled={pending}
					onClick={cancel}
					size="sm"
					variant="secondary"
				>
					Cancel
				</Button>
			</fieldset>
		) : null,
		dialog: (
			<>
				<Dialog
					onOpenChange={(open) => {
						if (!(open || pending)) {
							setConfirm(null);
						}
					}}
					open={confirm !== null}
				>
					<DialogContent>
						<DialogHeader>
							<DialogTitle>
								Delete {confirm?.length}{" "}
								{confirm?.length === 1 ? "Agent" : "Agents"}?
							</DialogTitle>
							<DialogDescription>
								These Agents will be removed from your account and Spaces.
								Existing messages stay in history. This can’t be undone.
							</DialogDescription>
						</DialogHeader>
						<ul className="max-h-48 space-y-2 overflow-y-auto text-sm">
							{confirm?.map((profile) => (
								<li className="break-words" key={profile.openMeldProfileId}>
									{profile.profileName}
								</li>
							))}
						</ul>
						<DialogFooter>
							<Button
								disabled={pending}
								onClick={() => setConfirm(null)}
								variant="secondary"
							>
								Cancel
							</Button>
							<Button disabled={pending} onClick={remove} variant="destructive">
								{pending
									? "Deleting…"
									: `Delete ${confirm?.length} ${confirm?.length === 1 ? "Agent" : "Agents"}`}
							</Button>
						</DialogFooter>
					</DialogContent>
				</Dialog>
				{failures.length > 0 && (
					<div
						className="space-y-1 rounded-md border border-destructive/30 p-3 text-sm"
						role="alert"
					>
						<p>Some Agents couldn’t be deleted. Review them and try again.</p>
						<ul>
							{failures.map((failure) => (
								<li key={failure.profileId}>
									{
										items.find(
											(item) =>
												item.profile.openMeldProfileId === failure.profileId
										)?.profile.profileName
									}
									: {failure.message}
								</li>
							))}
						</ul>
					</div>
				)}
			</>
		),
	};
}
