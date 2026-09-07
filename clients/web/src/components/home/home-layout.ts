import { z } from "zod/v4";

const cardSchema = z.object({
	id: z.string().min(1),
	kind: z.enum(["spaces", "team", "center-agent", "space"]),
	spaceId: z.string().optional(),
	x: z.number().finite(),
	y: z.number().finite(),
	width: z.number().min(280).max(1600),
	height: z.number().min(240).max(1600),
});
export const homeLayoutSchema = z.object({
	version: z.literal(1),
	cards: z.array(cardSchema),
	viewport: z
		.object({
			x: z.number().finite(),
			y: z.number().finite(),
			zoom: z.number().min(0.2).max(1.8),
		})
		.optional(),
});
export type HomeCard = z.infer<typeof cardSchema>;
export type HomeLayout = z.infer<typeof homeLayoutSchema>;

export function createHomeLayout(): HomeLayout {
	return {
		version: 1,
		cards: [
			{ id: "spaces", kind: "spaces", x: 0, y: 0, width: 420, height: 500 },
			{ id: "team", kind: "team", x: 452, y: 0, width: 320, height: 300 },
			{
				id: "center-agent",
				kind: "center-agent",
				x: 452,
				y: 332,
				width: 320,
				height: 300,
			},
		],
	};
}

export function homeLayoutStorageKey(
	accountId: string,
	organizationId: string
) {
	return `openmeld.home.v1:${encodeURIComponent(accountId)}:${encodeURIComponent(organizationId)}`;
}

export function parseHomeLayout(value: string | null): HomeLayout | null {
	if (!value) {
		return null;
	}
	try {
		const result = homeLayoutSchema.safeParse(JSON.parse(value));
		if (!result.success) {
			return null;
		}
		const ids = new Set(result.data.cards.map((card) => card.id));
		if (
			ids.size !== result.data.cards.length ||
			result.data.cards.some((card) => card.kind === "space" && !card.spaceId)
		) {
			return null;
		}
		return result.data;
	} catch {
		return null;
	}
}
