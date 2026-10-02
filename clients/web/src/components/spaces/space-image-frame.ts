import { spaceFileImageDimensionsSchema } from "@openmeld/schemas";
import type { CSSProperties } from "react";

export function resolveSpaceImageFrame(
	width?: number,
	height?: number
): CSSProperties {
	const dimensions = spaceFileImageDimensionsSchema.safeParse({
		width,
		height,
	});
	const original = dimensions.success
		? dimensions.data
		: { width: 288, height: 192 };
	const scale = Math.min(1, 512 / original.width, 512 / original.height);
	return {
		width: original.width * scale,
		maxWidth: "100%",
		aspectRatio: `${original.width} / ${original.height}`,
	};
}
