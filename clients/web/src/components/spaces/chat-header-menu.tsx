import { Button } from "@openmeld/ui/components/button";
import {
	Dialog,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@openmeld/ui/components/dialog";
import { DialogContent } from "@openmeld/ui/fluid/dialog";
import { FluidDropdownMenuItem } from "@openmeld/ui/fluid/dropdown-menu";
import { ArchiveIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { useMemberAgentSessionArchive } from "#/components/member-agents/member-agent-chat-history";
import { SpaceHeaderNavigationMenu } from "./space-header-navigation-menu";
import { useChatArchive } from "./use-chat-archive";

const PERSONAL_ARCHIVE_DESCRIPTION =
	"This conversation will be hidden from your list. You can find it under Archived direct messages. Message history is kept for everyone.";

type ChatArchiveController = {
	archived: boolean;
	disabled: boolean;
	label: string;
	confirmDescription: string;
	toggle: () => Promise<boolean>;
};

type ChatHeaderMenuProps = {
	spaceId: string;
	onOpenConversationInformation: () => void;
	ariaLabel?: string;
};

/**
 * Chat menu with Archive. A personal chat is archived from your own list; a
 * MemberAgent Session is archived through Core's Session operation. Both use
 * the same item and confirmation.
 */
export function ChatHeaderMenu({
	sessionAgentProfileId,
	...input
}: ChatHeaderMenuProps & { sessionAgentProfileId?: string | null }) {
	return sessionAgentProfileId ? (
		<SessionChatHeaderMenu {...input} agentProfileId={sessionAgentProfileId} />
	) : (
		<PersonalChatHeaderMenu {...input} />
	);
}

function PersonalChatHeaderMenu(input: ChatHeaderMenuProps) {
	const archive = useChatArchive(input.spaceId);
	return (
		<ChatHeaderMenuView
			{...input}
			archive={{ ...archive, confirmDescription: PERSONAL_ARCHIVE_DESCRIPTION }}
		/>
	);
}

function SessionChatHeaderMenu(
	input: ChatHeaderMenuProps & { agentProfileId: string }
) {
	const archive = useMemberAgentSessionArchive(
		input.spaceId,
		input.agentProfileId
	);
	return <ChatHeaderMenuView {...input} archive={archive} />;
}

function ChatHeaderMenuView({
	archive,
	ariaLabel = "Chat menu",
	onOpenConversationInformation,
}: ChatHeaderMenuProps & { archive: ChatArchiveController }) {
	const [confirmOpen, setConfirmOpen] = useState(false);
	const confirmArchive = async () => {
		if (await archive.toggle()) {
			setConfirmOpen(false);
		}
	};
	return (
		<>
			<SpaceHeaderNavigationMenu
				ariaLabel={ariaLabel}
				items={[]}
				onOpenConversationInformation={onOpenConversationInformation}
			>
				<FluidDropdownMenuItem
					disabled={archive.disabled}
					index={1}
					onClick={
						archive.archived ? archive.toggle : () => setConfirmOpen(true)
					}
				>
					<ArchiveIcon
						aria-hidden="true"
						weight={archive.archived ? "fill" : "regular"}
					/>
					{archive.label}
				</FluidDropdownMenuItem>
			</SpaceHeaderNavigationMenu>
			<Dialog onOpenChange={setConfirmOpen} open={confirmOpen}>
				<DialogContent size="sm">
					<DialogHeader>
						<DialogTitle>Archive conversation?</DialogTitle>
						<DialogDescription>{archive.confirmDescription}</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button onClick={() => setConfirmOpen(false)} variant="secondary">
							Cancel
						</Button>
						<Button disabled={archive.disabled} onClick={confirmArchive}>
							Archive conversation
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}
