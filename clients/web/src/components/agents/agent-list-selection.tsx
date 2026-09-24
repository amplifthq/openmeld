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
import {
	ArrowCounterClockwiseIcon,
	CheckSquareIcon,
	CircleNotchIcon,
	TrashIcon,
	XIcon,
} from "@phosphor-icons/react";
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
	const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(new Set());
	const running = useRef(false);
	const [failures, setFailures] = useState<
		(AgentDeleteFailure & { profileName: string })[]
	>([]);
	const [failedProfiles, setFailedProfiles] = useState<
		readonly AuthProfileView[]
	>([]);
	const selected = items
		.filter((item) => ids.has(item.profile.openMeldProfileId))
		.map((item) => item.profile);
	const reset = () => {
		setIds(new Set());
		setFailures([]);
		setFailedProfiles([]);
	};
	const cancel = () => {
		reset();
		setActive(false);
	};
	const remove = async () => {
		if (!(confirm && onDelete) || running.current) {
			return;
		}
		const profiles = confirm;
		running.current = true;
		setConfirm(null);
		setPending(true);
		setPendingIds(
			new Set(profiles.map((profile) => profile.openMeldProfileId))
		);
		setIds(new Set());
		setFailures([]);
		setFailedProfiles([]);
		const count = profiles.length;
		const toastId = toast.loading(
			`Deleting ${count} ${count === 1 ? "Agent" : "Agents"}…`
		);
		try {
			const result = await onDelete(profiles);
			const deleted = count - result.length;
			setFailures(
				result.map((failure) => ({
					...failure,
					profileName:
						profiles.find(
							(profile) => profile.openMeldProfileId === failure.profileId
						)?.profileName ?? "Agent",
				}))
			);
			setFailedProfiles(
				profiles.filter((profile) =>
					result.some(
						(failure) => failure.profileId === profile.openMeldProfileId
					)
				)
			);
			setIds(new Set(result.map((failure) => failure.profileId)));
			setActive(result.length > 0);
			showAgentDeleteResult(deleted, result.length, toastId);
		} catch (error) {
			setFailures(
				profiles.map((profile) => ({
					profileId: profile.openMeldProfileId,
					profileName: profile.profileName,
					message:
						error instanceof Error
							? error.message
							: "Couldn’t confirm deletion. Try again.",
				}))
			);
			setFailedProfiles(profiles);
			setIds(new Set(profiles.map((profile) => profile.openMeldProfileId)));
			toast.error(
				"Couldn’t confirm Agent deletion. Review the list and try again.",
				{ id: toastId }
			);
		} finally {
			running.current = false;
			setPending(false);
			setPendingIds(new Set());
		}
	};
	return {
		active,
		pendingIds,
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
			<AgentSelectionToolbar
				itemCount={items.length}
				onCancel={cancel}
				onDelete={() => setConfirm(selected)}
				onSelectAll={() =>
					setIds(
						selected.length === items.length
							? new Set()
							: new Set(items.map((item) => item.profile.openMeldProfileId))
					)
				}
				pending={pending}
				pendingCount={pendingIds.size}
				selectedCount={selected.length}
			/>
		) : null,
		dialog: (
			<>
				<Dialog
					onOpenChange={(open) => {
						if (!open) {
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
							<Button onClick={() => setConfirm(null)} variant="secondary">
								Cancel
							</Button>
							<Button onClick={remove} variant="destructive">
								<TrashIcon />
								{`Delete ${confirm?.length} ${confirm?.length === 1 ? "Agent" : "Agents"}`}
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
									{failure.profileName}: {failure.message}
								</li>
							))}
						</ul>
						<Button
							onClick={() => setConfirm(failedProfiles)}
							size="sm"
							variant="secondary"
						>
							<ArrowCounterClockwiseIcon />
							Review failed Agents
						</Button>
					</div>
				)}
			</>
		),
	};
}

function AgentSelectionToolbar(input: {
	itemCount: number;
	onCancel: () => void;
	onDelete: () => void;
	onSelectAll: () => void;
	pending: boolean;
	pendingCount: number;
	selectedCount: number;
}) {
	const allSelected =
		input.selectedCount === input.itemCount && input.itemCount > 0;
	return (
		<fieldset
			aria-label="Agent selection"
			className="flex flex-wrap items-center gap-2"
		>
			<output className="mr-auto flex items-center gap-2 text-sm">
				<span hidden={!input.pending}>
					<CircleNotchIcon aria-hidden="true" className="animate-spin" />
				</span>
				{input.pending
					? `Deleting ${input.pendingCount} ${input.pendingCount === 1 ? "Agent" : "Agents"}…`
					: `${input.selectedCount} selected`}
			</output>
			<Button
				disabled={input.pending || input.itemCount === 0}
				onClick={input.onSelectAll}
				size="sm"
				variant="secondary"
			>
				{allSelected ? <XIcon /> : <CheckSquareIcon />}
				{allSelected ? "Deselect all" : "Select visible"}
			</Button>
			<Button
				disabled={input.pending || input.selectedCount === 0}
				onClick={input.onDelete}
				size="sm"
				variant="destructive"
			>
				<TrashIcon />
				Delete{input.selectedCount ? ` (${input.selectedCount})` : ""}
			</Button>
			<Button
				disabled={input.pending}
				onClick={input.onCancel}
				size="sm"
				variant="secondary"
			>
				<XIcon />
				Cancel
			</Button>
		</fieldset>
	);
}

function showAgentDeleteResult(
	deleted: number,
	failed: number,
	toastId: string | number
): void {
	if (failed > 0) {
		toast.error(
			`${deleted} deleted. ${failed} ${failed === 1 ? "Agent needs" : "Agents need"} attention.`,
			{ id: toastId }
		);
		return;
	}
	toast.success(`${deleted} ${deleted === 1 ? "Agent" : "Agents"} deleted.`, {
		id: toastId,
	});
}
