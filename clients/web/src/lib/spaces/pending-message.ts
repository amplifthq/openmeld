import type { ComposerFileDraft } from "./composer-file-drafts";

export type PendingSpaceMessage = {
	files?: readonly File[];
	fileDrafts?: ComposerFileDraft[];
	clientMessageId: string;
	createdAtMs: number;
	text: string;
};
