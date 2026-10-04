import { describe, expect, it, vi } from "vitest";
import { drawAgentActivityField } from "./landing-page-ascii-scenes";

describe("drawAgentActivityField", () => {
	it("keeps the glyph grid intact while spreading and strengthening the activity lanes", () => {
		let currentAlpha = 1;
		const glyphs: Array<{
			alpha: number;
			character: string;
			x: number;
			y: number;
		}> = [];
		const context = {
			clearRect: vi.fn(),
			fillStyle: "",
			font: "",
			get globalAlpha() {
				return currentAlpha;
			},
			set globalAlpha(value: number) {
				currentAlpha = value;
			},
			textAlign: "",
			textBaseline: "",
			fillText(character: string, x: number, y: number) {
				glyphs.push({
					alpha: currentAlpha,
					character,
					x,
					y,
				});
			},
		} as unknown as CanvasRenderingContext2D;

		drawAgentActivityField({
			color: "#fff",
			context,
			fontFamily: "Geist Pixel",
			height: 320,
			pointerX: 0,
			pointerY: 0,
			timeSeconds: 0,
			width: 700,
		});

		const columnCount = Math.ceil(700 / 14);
		const laneGlyphCount = 5 * (columnCount + 1);
		const backgroundGlyphs = glyphs.slice(0, -laneGlyphCount);
		const laneGlyphs = glyphs.slice(-laneGlyphCount);
		const lanes = Array.from({ length: 5 }, (_, lane) =>
			laneGlyphs.slice(lane * (columnCount + 1), (lane + 1) * (columnCount + 1))
		);

		expect(context.font).toBe("500 9px Geist Pixel");
		expect(lanes[0]?.slice(0, 3).map((glyph) => glyph.x)).toEqual([0, 14, 28]);
		expect(
			Math.max(...backgroundGlyphs.map((glyph) => glyph.alpha))
		).toBeGreaterThan(0.095);
		expect(Math.min(...laneGlyphs.map((glyph) => glyph.alpha))).toBeGreaterThan(
			0.24
		);

		const laneCenters = lanes.map(
			(lane) =>
				lane.reduce((sum, glyph) => sum + glyph.y, 0) / Math.max(lane.length, 1)
		);
		expect((laneCenters.at(-1) ?? 0) - (laneCenters[0] ?? 0)).toBeGreaterThan(
			320 * 0.72
		);
	});
});
