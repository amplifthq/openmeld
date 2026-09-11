import { z } from "zod/v4";

const recommendationRecordSchema = z.discriminatedUnion("status", [
	z.object({ exchangeId: z.string(), status: z.literal("dismissed") }),
	z.object({
		exchangeId: z.string(),
		status: z.literal("message"),
		profileId: z.string(),
		clientMessageId: z.string(),
	}),
]);

export type WakeRecommendationRecord = z.infer<
	typeof recommendationRecordSchema
>;

export function wakeRecommendationSessionKey(input: {
	orgSlug?: string;
	selfProfileId: string;
	spaceId?: string;
}): string | null {
	return input.orgSlug && input.spaceId
		? `openmeld:wake-recommendation:v1:${JSON.stringify([
				input.orgSlug,
				input.selfProfileId,
				input.spaceId,
			])}`
		: null;
}

export function readWakeRecommendationRecord(key: string | null) {
	if (!key) {
		return null;
	}
	try {
		const raw = window.sessionStorage.getItem(key);
		const result = recommendationRecordSchema.safeParse(
			raw ? JSON.parse(raw) : null
		);
		return result.success ? result.data : null;
	} catch {
		// Recommendation memory must not block composing when storage is unavailable.
		return null;
	}
}

export function writeWakeRecommendationRecord(
	key: string | null,
	record: WakeRecommendationRecord
) {
	if (!key) {
		return;
	}
	try {
		window.sessionStorage.setItem(key, JSON.stringify(record));
	} catch {
		// The current mounted conversation still remembers the choice.
	}
}
