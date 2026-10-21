import { Button } from "@openmeld/ui/components/button";
import {
	Dialog,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@openmeld/ui/components/dialog";
import { DropdownMenuSeparator } from "@openmeld/ui/components/dropdown-menu";
import { DialogContent } from "@openmeld/ui/fluid/dialog";
import { FluidDropdownMenuItem } from "@openmeld/ui/fluid/dropdown-menu";
import { TrashIcon } from "@phosphor-icons/react";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { useSidebarPreferences } from "#/components/app/use-sidebar-preferences";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import {
	agentDirectMessageSessionQueryKeys,
	createAgentDirectMessageSessionApi,
} from "#/query/organizations/agent-direct-message-sessions";
import { accountSpaceQueryKeys } from "#/query/spaces/account-spaces";

/**
 * Core's dedicated Session operations for the current agent Direct Message
 * Session (a MemberAgent Session or a Center Agent session). Rename and
 * archive plug into the existing chat-title editor and chat-menu archive;
 * only Delete, which has no existing control, brings its own confirmation.
 * Nothing is archived automatically.
 */
export function useDirectMessageSessionActions(input: {
	spaceId: string;
	onLeave: () => Promise<void> | void;
	extraRefresh?: () => Promise<unknown>;
	/** False renders no Delete control (feature off or no current Session). */
	enabled?: boolean;
}) {
	const { currentOrganization: organization } = useAppOrganization();
	const queryClient = useQueryClient();
	const sidebar = useSidebarPreferences(organization.id);
	const [deleteOpen, setDeleteOpen] = useState(false);
	const [pending, setPending] = useState(false);
	const sessionApi = createAgentDirectMessageSessionApi(organization.id);
	const refresh = async () => {
		await Promise.all([
			queryClient.invalidateQueries({
				queryKey: agentDirectMessageSessionQueryKeys.all(organization.id),
			}),
			queryClient.invalidateQueries({ queryKey: accountSpaceQueryKeys.all }),
			input.extraRefresh?.(),
		]);
	};
	const run = async (
		action: () => Promise<unknown>,
		failure: string
	): Promise<boolean> => {
		setPending(true);
		try {
			await action();
			await refresh();
			return true;
		} catch (error) {
			console.error(failure, error);
			toast.error(failure);
			return false;
		} finally {
			setPending(false);
		}
	};
	// A Session rename is the chat's name for everyone in it; drop an older
	// personal title so it no longer hides the new name.
	const clearPersonalTitle = async () => {
		if (!sidebar.preferences?.chats?.titles[input.spaceId]) {
			return;
		}
		await sidebar.updateAsync((current) => {
			if (!current.chats?.titles[input.spaceId]) {
				return current;
			}
			const { [input.spaceId]: _removed, ...rest } = current.chats.titles;
			return { ...current, chats: { ...current.chats, titles: rest } };
		});
	};
	/** For the existing chat-title editor; throws so it shows its error. */
	const rename = async (name: string) => {
		await sessionApi.updateSession({
			spaceId: input.spaceId,
			update: { operation: "rename", name },
		});
		await refresh();
		await clearPersonalTitle();
	};
	const setArchived = (archived: boolean) =>
		run(
			() =>
				sessionApi.updateSession({
					spaceId: input.spaceId,
					update: { operation: archived ? "archive" : "unarchive" },
				}),
			archived
				? "Couldn’t archive this chat. Try again."
				: "Couldn’t restore this chat. Try again."
		);
	const enabled = input.enabled !== false;
	const renderMenuItems = (startIndex: number) =>
		enabled ? (
			<>
				<DropdownMenuSeparator />
				<FluidDropdownMenuItem
					className="px-3 text-destructive text-sm"
					index={startIndex}
					onClick={() => setDeleteOpen(true)}
				>
					<TrashIcon aria-hidden="true" />
					Delete chat
				</FluidDropdownMenuItem>
			</>
		) : null;
	const dialogs = enabled ? (
		<Dialog onOpenChange={setDeleteOpen} open={deleteOpen}>
			<DialogContent size="sm">
				<DialogHeader>
					<DialogTitle>Delete this chat?</DialogTitle>
					<DialogDescription>
						The chat and its messages are deleted for you and the Agent. This
						can’t be undone.
					</DialogDescription>
				</DialogHeader>
				<DialogFooter>
					<Button onClick={() => setDeleteOpen(false)} variant="secondary">
						Cancel
					</Button>
					<Button
						disabled={pending}
						onClick={async () => {
							const deleted = await run(
								() => sessionApi.deleteSession({ spaceId: input.spaceId }),
								"Couldn’t delete this chat. Finish or stop its work, then try again."
							);
							if (deleted) {
								setDeleteOpen(false);
								await input.onLeave();
							}
						}}
						variant="destructive"
					>
						Delete chat
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	) : null;
	return { pending, run, rename, setArchived, renderMenuItems, dialogs };
}
