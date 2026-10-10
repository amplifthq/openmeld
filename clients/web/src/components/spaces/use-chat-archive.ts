import { toast } from "sonner";
import { useSidebarPreferences } from "#/components/app/use-sidebar-preferences";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import { mergeChatPreferences } from "./chat-sidebar-model";

/** Personal list cleanup; never deletes a Space or changes its membership. */
export function useChatArchive(spaceId: string) {
	const { currentOrganization } = useAppOrganization();
	const store = useSidebarPreferences(currentOrganization.id);
	const chats = mergeChatPreferences(store.preferences, []);
	const archived = chats.archivedIds.includes(spaceId);
	const toggle = async () => {
		if (!store.preferences || store.disabled) {
			return false;
		}
		try {
			await store.updateAsync((current) => {
				const currentChats = mergeChatPreferences(current, []);
				return {
					...current,
					messages: undefined,
					chats: {
						...currentChats,
						archivedIds: archived
							? currentChats.archivedIds.filter((id) => id !== spaceId)
							: [...new Set([...currentChats.archivedIds, spaceId])],
					},
				};
			});
			toast.success(
				archived ? "Conversation unarchived" : "Conversation archived",
				{
					description: archived
						? "This conversation is back in your list."
						: "Hidden from your list. Find it under Archived direct messages. History is kept for everyone.",
				}
			);
			return true;
		} catch {
			// The preference mutation reports the error and restores the list.
			return false;
		}
	};
	return {
		archived,
		disabled: store.disabled,
		toggle,
		label: archived ? "Unarchive conversation" : "Archive conversation",
	};
}
