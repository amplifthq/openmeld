import { useSidebarDisclosure } from "../app/use-sidebar-disclosure";

const CONVERSATIONS_PREFIX = /^Conversations:/;
const GROUP_PREFIX = /^(space|chat):/;

export function useConversationDisclosure(
	profileId: string,
	organizationId: string,
	selected: string | null,
	activeSection: string | null,
	searching: boolean
) {
	const chatSection =
		activeSection === "chats" || activeSection?.startsWith("chat:");
	const activeId = activeSection?.replace(GROUP_PREFIX, "") ?? null;
	const spaces = useSidebarDisclosure(
		"space",
		profileId,
		organizationId,
		chatSection ? null : activeId,
		selected ?? "",
		["pinned", "spaces", "recent"]
	);
	const chats = useSidebarDisclosure(
		"chat",
		profileId,
		organizationId,
		chatSection ? activeId : null,
		selected ?? "",
		["chats"]
	);
	const target = (id: string) =>
		id === "chats" || id.startsWith("chat:") ? chats : spaces;
	return {
		isOpen: (id: string) => {
			const section = id.replace(CONVERSATIONS_PREFIX, "");
			return (
				searching || target(section).isOpen(section.replace(GROUP_PREFIX, ""))
			);
		},
		setOpen: (id: string, open: boolean) => {
			const section = id.replace(CONVERSATIONS_PREFIX, "");
			if (!searching) {
				target(section).setOpen(section.replace(GROUP_PREFIX, ""), open);
			}
		},
	};
}
