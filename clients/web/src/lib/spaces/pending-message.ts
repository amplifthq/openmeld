import type { ComposerFileSelection } from "./composer-file-drafts";

export type PendingSpaceMessage = {
	files?: readonly File[];
	fileDrafts?: ComposerFileSelection[];
	clientMessageId: string;
	createdAtMs: number;
	text: string;
};
