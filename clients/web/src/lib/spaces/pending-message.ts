import type { ComposerFileSelection } from "./composer-file-drafts";

export type PendingSpaceMessage = {
	taskDraft?: import("@openmeld/schemas/types").SignalText["data"]["taskDraft"];
	files?: readonly File[];
	fileDrafts?: ComposerFileSelection[];
	clientMessageId: string;
	createdAtMs: number;
	text: string;
};
