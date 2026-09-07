import { z } from "zod/v4";

const cardSchema = z.object({
	id: z.string().min(1),
	kind: z.enum(["welcome", "center-agent", "space"]),
	spaceId: z.string().optional(),
	guideDismissed: z.boolean().optional(),
	x: z.number().finite(),
	y: z.number().finite(),
	width: z.number().min(280).max(1600),
	height: z.number().min(240).max(1600),
});
export const homeLayoutSchema = z.object({
	version: z.literal(2),
	readableViewport: z.boolean().optional(),
	hintsDismissed: z.boolean().optional(),
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

export function homeStartViewport(cards: readonly HomeCard[], width: number) {
	const left = Math.min(0, ...cards.map((card) => card.x));
	const right = Math.max(620, ...cards.map((card) => card.x + card.width));
	const top = Math.min(0, ...cards.map((card) => card.y));
	return {
		x: Math.max(24, (width - (right - left)) / 2) - left,
		y: 64 - top,
		zoom: 1,
	};
}

/** Only a settled, successful account index may remove saved windows. */
export function reconcileHomeSpaces(
	layout: HomeLayout,
	spaceIds: ReadonlySet<string> | null
): HomeLayout {
	if (!spaceIds) {
		return layout;
	}
	const cards = layout.cards.filter(
		(card) =>
			card.kind !== "space" ||
			(card.spaceId !== undefined && spaceIds.has(card.spaceId))
	);
	return cards.length === layout.cards.length ? layout : { ...layout, cards };
}

export function createHomeLayout(): HomeLayout {
	return {
		version: 2,
		cards: [
			{ id: "welcome", kind: "welcome", x: 310, y: 0, width: 680, height: 240 },
			{
				id: "center-agent",
				kind: "center-agent",
				x: 0,
				y: 280,
				width: 620,
				height: 640,
			},
		],
	};
}

export function homeLayoutStorageKey(
	accountId: string,
	organizationId: string
) {
	return `openmeld.home.v2:${encodeURIComponent(accountId)}:${encodeURIComponent(organizationId)}`;
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
