import { Button } from "@openmeld/ui/components/button";
import { TooltipHint } from "@openmeld/ui/components/tooltip";
import { ArchiveIcon } from "@phosphor-icons/react";
import { toast } from "sonner";
import { useSidebarPreferences } from "#/components/app/use-sidebar-preferences";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import { mergeChatPreferences } from "./chat-sidebar-model";

/** Personal list cleanup; never deletes a Space or changes its membership. */
export function ChatArchiveButton({
	spaceId,
	profileId,
}: {
	spaceId: string;
	profileId: string;
}) {
	const { currentOrganization } = useAppOrganization();
	const store = useSidebarPreferences(profileId, currentOrganization.id);
	const chats = mergeChatPreferences(store.preferences, []);
	const archived = chats.archivedIds.includes(spaceId);
	const label = archived ? "Unarchive conversation" : "Archive conversation";
	const toggle = async () => {
		if (!store.preferences || store.disabled) {
			return;
		}
		try {
			await store.saveAsync({
				...store.preferences,
				messages: undefined,
				chats: {
					...chats,
					archivedIds: archived
						? chats.archivedIds.filter((id) => id !== spaceId)
						: [...chats.archivedIds, spaceId],
				},
			});
			toast.success(
				archived ? "Conversation unarchived" : "Conversation archived",
				{
					description: archived
						? "This conversation is back in your list."
						: "Hidden from your list. Find it under Archived direct messages. History is kept for everyone.",
				}
			);
		} catch {
			// The shared preference mutation reports the error and restores the list.
		}
	};
	return (
		<TooltipHint content={label}>
			<Button
				aria-label={label}
				disabled={store.disabled}
				onClick={toggle}
				size="icon-sm"
				variant="ghost"
			>
				<ArchiveIcon weight={archived ? "fill" : "regular"} />
			</Button>
		</TooltipHint>
	);
}
