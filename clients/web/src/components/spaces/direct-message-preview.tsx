import { sanitizeSignalTextPreview } from "@openmeld/schemas";
import { queryOptions, useQuery } from "@tanstack/react-query";
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

export function useSpaceMessagePreview(input: {
	spaceId: string;
	viewerProfileId: string;
	enabled: boolean;
}) {
	return useQuery(spaceMessagePreviewQueryOptions(input));
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
						timestamp: message.ts,
						text: sanitizeSignalTextPreview(message.data.text) ?? "Message",
					}
				: null;
		},
		staleTime: 15_000,
		refetchInterval: 30_000,
	});
}
