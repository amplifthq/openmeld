import { Button } from "@openmeld/ui/components/button";
import {
	Dialog,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@openmeld/ui/components/dialog";
import { DropdownMenuSeparator } from "@openmeld/ui/components/dropdown-menu";
import { Input } from "@openmeld/ui/components/input";
import { DialogContent } from "@openmeld/ui/fluid/dialog";
import { FluidDropdownMenuItem } from "@openmeld/ui/fluid/dropdown-menu";
import {
	ArchiveIcon,
	PencilSimpleIcon,
	TrashIcon,
} from "@phosphor-icons/react";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import {
	agentDirectMessageSessionQueryKeys,
	createAgentDirectMessageSessionApi,
} from "#/query/organizations/agent-direct-message-sessions";
import { accountSpaceQueryKeys } from "#/query/spaces/account-spaces";

type SessionDialog = "rename" | "archive" | "delete" | null;

/**
 * Rename, Archive, and Delete for the current agent Direct Message Session
 * (a MemberAgent Session or a Center Agent session). These call Core's
 * dedicated Session operations; nothing is archived automatically.
 */
export function useDirectMessageSessionActions(input: {
	spaceId: string;
	title: string;
	onLeave: () => Promise<void> | void;
	extraRefresh?: () => Promise<unknown>;
	/** False renders no controls (feature off or no current Session). */
	enabled?: boolean;
}) {
	const { currentOrganization: organization } = useAppOrganization();
	const queryClient = useQueryClient();
	const [dialog, setDialog] = useState<SessionDialog>(null);
	const [name, setName] = useState("");
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
		failure: string,
		after?: () => Promise<void> | void
	) => {
		setPending(true);
		try {
			await action();
			await refresh();
			setDialog(null);
			await after?.();
		} catch (error) {
			console.error(failure, error);
			toast.error(failure);
		} finally {
			setPending(false);
		}
	};
	const enabled = input.enabled !== false;
	const renderMenuItems = (startIndex: number) =>
		enabled ? (
			<>
				<DropdownMenuSeparator />
				<FluidDropdownMenuItem
					className="px-3 text-sm"
					index={startIndex}
					onClick={() => {
						setName(input.title === "New chat" ? "" : input.title);
						setDialog("rename");
					}}
				>
					<PencilSimpleIcon aria-hidden="true" />
					Rename chat
				</FluidDropdownMenuItem>
				<FluidDropdownMenuItem
					className="px-3 text-sm"
					index={startIndex + 1}
					onClick={() => setDialog("archive")}
				>
					<ArchiveIcon aria-hidden="true" />
					Archive chat
				</FluidDropdownMenuItem>
				<FluidDropdownMenuItem
					className="px-3 text-destructive text-sm"
					index={startIndex + 2}
					onClick={() => setDialog("delete")}
				>
					<TrashIcon aria-hidden="true" />
					Delete chat
				</FluidDropdownMenuItem>
			</>
		) : null;
	const dialogs = enabled ? (
		<Dialog
			onOpenChange={(next) => setDialog(next ? dialog : null)}
			open={dialog !== null}
		>
			<DialogContent size="sm">
				{dialog === "rename" ? (
					<form
						className="space-y-4"
						onSubmit={(event) => {
							event.preventDefault();
							if (!name.trim() || pending) {
								return;
							}
							run(
								() =>
									sessionApi.updateSession({
										spaceId: input.spaceId,
										update: { operation: "rename", name: name.trim() },
									}),
								"Couldn’t rename this chat. Try again."
							).catch(console.error);
						}}
					>
						<DialogHeader>
							<DialogTitle>Rename chat</DialogTitle>
						</DialogHeader>
						<Input
							aria-label="Chat name"
							autoFocus
							maxLength={160}
							onChange={(event) => setName(event.target.value)}
							value={name}
						/>
						<DialogFooter>
							<Button disabled={pending || !name.trim()} type="submit">
								Save
							</Button>
						</DialogFooter>
					</form>
				) : null}
				{dialog === "archive" ? (
					<>
						<DialogHeader>
							<DialogTitle>Archive this chat?</DialogTitle>
							<DialogDescription>
								It moves to Archived chats. Its messages are kept, and you can
								restore it later.
							</DialogDescription>
						</DialogHeader>
						<DialogFooter>
							<Button onClick={() => setDialog(null)} variant="secondary">
								Cancel
							</Button>
							<Button
								disabled={pending}
								onClick={() => {
									run(
										() =>
											sessionApi.updateSession({
												spaceId: input.spaceId,
												update: { operation: "archive" },
											}),
										"Couldn’t archive this chat. Try again.",
										input.onLeave
									).catch(console.error);
								}}
							>
								Archive chat
							</Button>
						</DialogFooter>
					</>
				) : null}
				{dialog === "delete" ? (
					<>
						<DialogHeader>
							<DialogTitle>Delete this chat?</DialogTitle>
							<DialogDescription>
								The chat and its messages are deleted for you and the Agent.
								This can’t be undone.
							</DialogDescription>
						</DialogHeader>
						<DialogFooter>
							<Button onClick={() => setDialog(null)} variant="secondary">
								Cancel
							</Button>
							<Button
								disabled={pending}
								onClick={() => {
									run(
										() => sessionApi.deleteSession({ spaceId: input.spaceId }),
										"Couldn’t delete this chat. Finish or stop its work, then try again.",
										input.onLeave
									).catch(console.error);
								}}
								variant="destructive"
							>
								Delete chat
							</Button>
						</DialogFooter>
					</>
				) : null}
			</DialogContent>
		</Dialog>
	) : null;
	return { pending, run, renderMenuItems, dialogs };
}
