import { Button } from "@openmeld/ui/components/button";
import { TooltipHint } from "@openmeld/ui/components/tooltip";
import { ArchiveIcon } from "@phosphor-icons/react";
import { ChatDeleteButton } from "./chat-delete-button";
import { useChatArchive } from "./use-chat-archive";

export function ChatArchiveButton(input: { spaceId: string }) {
	const archive = useChatArchive(input.spaceId);
	return (
		<>
			<TooltipHint content={archive.label}>
				<Button
					aria-label={archive.label}
					disabled={archive.disabled}
					onClick={archive.toggle}
					size="icon-sm"
					variant="ghost"
				>
					<ArchiveIcon weight={archive.archived ? "fill" : "regular"} />
				</Button>
			</TooltipHint>
			{archive.archived && <ChatDeleteButton spaceId={input.spaceId} />}
		</>
	);
}
