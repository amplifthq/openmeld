import { sanitizeSignalTextPreview } from "@openmeld/schemas";
import { queryOptions } from "@tanstack/react-query";
import { createUnscopedWebSpaceApi } from "#/lib/spaces/api";

export function formatDirectMessageTime(
	timestamp: number,
	now = new Date()
): string {
	const date = new Date(timestamp);
	const day = (value: Date) =>
		Date.UTC(value.getFullYear(), value.getMonth(), value.getDate());
	const days = Math.max(0, Math.round((day(now) - day(date)) / 86_400_000));
	if (days === 0) {
		return date.toLocaleTimeString("en-US", {
			hour: "numeric",
			minute: "2-digit",
			hour12: true,
		});
	}
	return days === 1 ? "Yesterday" : `${days} days ago`;
}

export function spaceMessagePreviewQueryOptions(input: {
	spaceId: string;
	viewerProfileId: string;
	enabled: boolean;
}) {
	return queryOptions({
		queryKey: [
			"spaces",
			input.spaceId,
			"incoming-preview",
			input.viewerProfileId,
		],
		enabled: input.enabled,
		queryFn: async ({ signal }) => {
			const result = await createUnscopedWebSpaceApi({
				openMeldProfileId: input.viewerProfileId,
			}).listSignalEnvelopes({
				spaceId: input.spaceId,
				signal,
				query: {
					recent: true,
					limit: 1,
					kinds: ["text"],
				},
			});
			const message = result.envelopes.find(
				(entry) => entry.type === "signal.text"
			);
			return message?.type === "signal.text"
				? {
						signalId: message.id,
						timestamp: message.ts,
						text: sanitizeSignalTextPreview(message.data.text) ?? "Message",
					}
				: null;
		},
		// No per-chat poll: this read only covers a chat whose Space index preview
		// is not projected yet. Its next message projects that preview, and the
		// owning lists (account Space items, Center Agent sessions) already
		// refresh through push and their own polling, which moves the chat onto
		// the projected preview. Polling here multiplied one request per chat.
		staleTime: 15_000,
	});
}
