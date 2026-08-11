"use client";

import {
	DEFAULT_ROUNDED_SHAPE_RADIUS_PX,
	ShapeProvider,
	type ShapeVariant,
} from "@openmeld/ui/lib/shape-context";
import { type ReactNode, useCallback, useSyncExternalStore } from "react";
import {
	DEFAULT_APPEARANCE_SHAPE,
	readAppearanceShapePreference,
	subscribeToAppearanceShapePreference,
	writeAppearanceShapePreference,
} from "#/lib/appearance/shape-preference";

export function AppearanceShapeProvider({ children }: { children: ReactNode }) {
	const shape = useSyncExternalStore(
		subscribeToAppearanceShapePreference,
		readAppearanceShapePreference,
		() => DEFAULT_APPEARANCE_SHAPE
	);

	const setShape = useCallback((nextShape: ShapeVariant) => {
		writeAppearanceShapePreference(nextShape);
	}, []);

	return (
		<ShapeProvider
			onShapeChange={setShape}
			roundedRadiusPx={DEFAULT_ROUNDED_SHAPE_RADIUS_PX}
			shape={shape}
		>
			{children}
		</ShapeProvider>
	);
}
