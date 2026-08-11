import type { SpaceMeta } from "@openmeld/schemas/types";

export async function persistSpaceNameUpdate(input: {
	applyCanonicalName: (name: string) => void;
	onRefreshFailure: (error: unknown) => void;
	refreshProjections: () => Promise<void>;
	updateMeta: () => Promise<Pick<SpaceMeta, "name">>;
}): Promise<string> {
	const updatedMeta = await input.updateMeta();
	const canonicalName = updatedMeta.name;
	if (!canonicalName) {
		throw new Error("OpenMeld could not confirm the updated Space name.");
	}
	input.applyCanonicalName(canonicalName);

	Promise.resolve()
		.then(input.refreshProjections)
		.catch(input.onRefreshFailure);

	return canonicalName;
}
