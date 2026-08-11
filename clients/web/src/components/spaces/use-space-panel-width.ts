import { useCallback, useEffect, useState } from "react";
import {
	readSpacePanelWidth,
	SPACE_PANEL_WIDTH_METRICS,
	type SpacePanelWidthPreference,
	writeSpacePanelWidth,
} from "#/lib/spaces/panel-width-storage";

export function useSpacePanelWidth(input: SpacePanelWidthPreference) {
	const panel = input.panel;
	const spaceId = input.panel === "members" ? input.spaceId : null;
	const metrics = SPACE_PANEL_WIDTH_METRICS[panel];
	const [width, setWidth] = useState<string>(metrics.defaultWidth);

	useEffect(() => {
		setWidth(readSpacePanelWidth(resolvePanelWidthPreference(panel, spaceId)));
	}, [panel, spaceId]);

	const handleWidthChange = useCallback(
		(nextWidth: string) => {
			const widthToStore = writeSpacePanelWidth({
				...resolvePanelWidthPreference(panel, spaceId),
				width: nextWidth,
			});
			setWidth(widthToStore);
		},
		[panel, spaceId]
	);

	return {
		...metrics,
		onWidthChange: handleWidthChange,
		width,
	};
}

function resolvePanelWidthPreference(
	panel: SpacePanelWidthPreference["panel"],
	spaceId: string | null
): SpacePanelWidthPreference {
	if (panel === "thread") {
		return { panel };
	}
	if (spaceId === null) {
		throw new Error("Members panel width requires a Space id.");
	}
	return { panel, spaceId };
}
