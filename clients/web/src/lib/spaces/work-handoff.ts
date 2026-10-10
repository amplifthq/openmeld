import type { SpaceApi } from "@openmeld/api-client";

export async function readWorkHandoffSource(
	api: SpaceApi,
	input: {
		spaceId: string;
		sourceSignalId: string;
		spacePassword?: string;
	}
) {
	const result = await api.listSignalEnvelopes({
		spaceId: input.spaceId,
		spacePassword: input.spacePassword,
		query: {
			aroundSignalId: input.sourceSignalId,
			beforeCount: 0,
			afterCount: 0,
			kinds: ["text"],
		},
	});
	const source = result.envelopes.find(
		(entry) => entry.id === input.sourceSignalId
	);
	if (
		!source ||
		source.type !== "signal.text" ||
		source.spaceId !== input.spaceId ||
		source.data.meta?.recalledAt !== undefined
	) {
		throw new Error(
			"The original result is unavailable. Reopen the message and try again."
		);
	}
	return {
		sourceSignalId: source.id,
		sourceRevision: source.data.meta?.messageRevision ?? 1,
		text: source.data.text,
		files: source.data.files ?? [],
	};
}
