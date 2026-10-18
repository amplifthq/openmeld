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
import { SpaceHeaderNavigationMenu } from "./space-header-navigation-menu";
import { useChatArchive } from "./use-chat-archive";

/** Personal list cleanup; never deletes a Space or changes its membership. */
export function ChatHeaderMenu({
	spaceId,
	onOpenConversationInformation,
	ariaLabel = "Chat menu",
	showArchive = true,
}: {
	spaceId: string;
	onOpenConversationInformation: () => void;
	ariaLabel?: string;
	/**
	 * False in a MemberAgent Session, which is archived through its dedicated
	 * Session operation in the title dropdown instead.
	 */
	showArchive?: boolean;
}) {
	const [confirmOpen, setConfirmOpen] = useState(false);
	const { archived, disabled, label, toggle } = useChatArchive(spaceId);
	const confirmArchive = async () => {
		if (await toggle()) {
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
				{showArchive ? (
					<FluidDropdownMenuItem
						disabled={disabled}
						index={1}
						onClick={archived ? toggle : () => setConfirmOpen(true)}
					>
						<ArchiveIcon
							aria-hidden="true"
							weight={archived ? "fill" : "regular"}
						/>
						{label}
					</FluidDropdownMenuItem>
				) : null}
			</SpaceHeaderNavigationMenu>
			<Dialog onOpenChange={setConfirmOpen} open={confirmOpen}>
				<DialogContent size="sm">
					<DialogHeader>
						<DialogTitle>Archive conversation?</DialogTitle>
						<DialogDescription>
							This conversation will be hidden from your list. You can find it
							under Archived direct messages. Message history is kept for
							everyone.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button onClick={() => setConfirmOpen(false)} variant="secondary">
							Cancel
						</Button>
						<Button disabled={disabled} onClick={confirmArchive}>
							Archive conversation
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}
