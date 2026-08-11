import { upsertProfileSpaceHistory } from "./upsert-profile-space-history";

export async function recordProfileSpaceHistory(input: {
	spaceId: string;
	spaceName: string | null;
	profileIds: readonly string[];
	creatorProfileId: string;
	creatorKind: "human" | "agent";
}) {
	await upsertProfileSpaceHistory({
		data: {
			spaceId: input.spaceId,
			...(input.spaceName === null ? {} : { spaceName: input.spaceName }),
			items: dedupeProfileHistoryItems(
				input.profileIds.map((profileId) => ({
					profileId,
				}))
			),
			creatorProfileId: input.creatorProfileId,
			creatorKind: input.creatorKind,
		},
	});
}

function dedupeProfileHistoryItems(
	items: ReadonlyArray<{ profileId: string }>
): Array<{ profileId: string }> {
	const seen = new Set<string>();
	const deduped: Array<{ profileId: string }> = [];

	for (const item of items) {
		if (seen.has(item.profileId)) {
			continue;
		}
		seen.add(item.profileId);
		deduped.push(item);
	}

	return deduped;
}
