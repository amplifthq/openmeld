export type PendingSpaceMessage = {
	files?: readonly File[];
	clientMessageId: string;
	createdAtMs: number;
	text: string;
};
