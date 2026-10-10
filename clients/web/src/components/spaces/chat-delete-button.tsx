import { Button } from "@openmeld/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogTitle,
} from "@openmeld/ui/components/dialog";
import { TooltipHint } from "@openmeld/ui/components/tooltip";
import { TrashIcon } from "@phosphor-icons/react";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { useSidebarPreferences } from "#/components/app/use-sidebar-preferences";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import { useDefaultHumanProfile } from "#/lib/profiles/use-default-human-profile";
import { createUnscopedWebSpaceApi } from "#/lib/spaces/api";
import { invalidateInboxFacts } from "#/query/organizations/inbox";
import { resolveAppQueryPersistenceController } from "#/query/persistence/app-query-persistence";
import { accountSpaceQueryKeys } from "#/query/spaces/account-spaces";
import { mergeChatPreferences } from "./chat-sidebar-model";
import {
	optimisticallyRemoveSpaceFromListCaches,
	restoreSpaceListCaches,
} from "./space-list-cache";

export function ChatDeleteButton({ spaceId }: { spaceId: string }) {
	const [open, setOpen] = useState(false);
	const [pending, setPending] = useState(false);
	const client = useQueryClient();
	const { currentOrganization: org, currentUserId } = useAppOrganization();
	const store = useSidebarPreferences(org.id);
	const { defaultHumanProfile } = useDefaultHumanProfile();
	const profileId = defaultHumanProfile?.openMeldProfileId;
	const remove = async () => {
		if (!profileId) {
			return;
		}
		setPending(true);
		const snapshot = await optimisticallyRemoveSpaceFromListCaches({
			queryClient: client,
			organizationId: org.id,
			spaceId,
		});
		let accepted = false;
		try {
			await createUnscopedWebSpaceApi({
				openMeldProfileId: profileId,
			}).deleteConversationForMe({ spaceId });
			accepted = true;
			client.removeQueries({
				predicate: (query) =>
					query.queryKey[0] === "spaces" && query.queryKey[2] === spaceId,
			});
			if (currentUserId) {
				await resolveAppQueryPersistenceController().clearSpaceConversation({
					queryClient: client,
					organizationId: org.id,
					organizationSlug: org.slug,
					ownerAccountId: currentUserId,
					spaceId,
					openMeldProfileId: profileId,
				});
			}
			await store.updateAsync((current) => {
				const chats = mergeChatPreferences(current, []);
				return {
					...current,
					chats: {
						...chats,
						archivedIds: chats.archivedIds.filter((id) => id !== spaceId),
					},
				};
			});
			await Promise.all([
				client.invalidateQueries({ queryKey: accountSpaceQueryKeys.all }),
				client.invalidateQueries({ queryKey: ["center-agent", org.id] }),
				invalidateInboxFacts({ organizationId: org.id, queryClient: client }),
			]);
			setOpen(false);
			toast.success("Conversation deleted for you");
		} catch (error) {
			if (!accepted) {
				restoreSpaceListCaches(client, org.id, snapshot);
			}
			const failure =
				error instanceof Error
					? error.message
					: "Could not delete this conversation.";
			toast.error(
				accepted
					? "The conversation was deleted, but your list could not refresh. Reload the page."
					: failure
			);
		} finally {
			snapshot.stopKeepingRemoved();
			setPending(false);
		}
	};
	return (
		<>
			<TooltipHint content="Delete for me">
				<Button
					aria-label="Delete for me"
					onClick={() => setOpen(true)}
					size="icon-sm"
					variant="ghost"
				>
					<TrashIcon />
				</Button>
			</TooltipHint>
			<Dialog
				onOpenChange={(next) => {
					if (!pending) {
						setOpen(next);
					}
				}}
				open={open}
			>
				<DialogContent>
					<DialogTitle>Delete this conversation for you?</DialogTitle>
					<DialogDescription>
						Your current messages will be removed from your history and search.
						Other participants keep their history. New messages can start the
						conversation again. This cannot be undone.
					</DialogDescription>
					<DialogFooter>
						<Button
							disabled={pending}
							onClick={() => setOpen(false)}
							variant="ghost"
						>
							Cancel
						</Button>
						<Button
							disabled={pending || !profileId}
							onClick={remove}
							variant="destructive"
						>
							{pending ? "Deleting…" : "Delete for me"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}
