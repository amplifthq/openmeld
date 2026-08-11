import {
	readBrowserPreference,
	removeBrowserPreference,
	writeBrowserPreference,
} from "./browser-preference-storage";

const PX_PER_REM = 16;
const WIDTH_PATTERN = /^(\d+(?:\.\d+)?)(px|rem)$/;
const TRAILING_ZERO_PATTERN = /\.?0+$/;

export type ResizableSpacePanelKind = "members" | "thread";

export type SpacePanelWidthPreference =
	| { panel: "members"; spaceId: string }
	| { panel: "thread" };

type SpacePanelWidthMetrics = {
	defaultWidth: string;
	maxWidth: string;
	minWidth: string;
};

export const SPACE_PANEL_WIDTH_METRICS = {
	members: {
		defaultWidth: "22rem",
		maxWidth: "32rem",
		minWidth: "17rem",
	},
	thread: {
		defaultWidth: "28rem",
		maxWidth: "30rem",
		minWidth: "22rem",
	},
} as const satisfies Record<ResizableSpacePanelKind, SpacePanelWidthMetrics>;

export function clampSpacePanelWidth(input: {
	panel: ResizableSpacePanelKind;
	width: string;
}): string {
	const metrics = SPACE_PANEL_WIDTH_METRICS[input.panel];
	const parsed = parseWidth(input.width);
	if (!parsed) {
		return metrics.defaultWidth;
	}

	const minPx = widthToPx(metrics.minWidth);
	const maxPx = widthToPx(metrics.maxWidth);
	const clampedPx = Math.max(minPx, Math.min(maxPx, parsed.valuePx));

	if (parsed.unit === "rem") {
		return `${formatNumber(clampedPx / PX_PER_REM)}rem`;
	}
	return `${Math.round(clampedPx)}px`;
}

export function readSpacePanelWidth(input: SpacePanelWidthPreference): string {
	const metrics = SPACE_PANEL_WIDTH_METRICS[input.panel];
	const storageKey = resolveSpacePanelWidthStorageKey(input);
	const rawValue = readBrowserPreference(storageKey);
	if (rawValue === null) {
		return metrics.defaultWidth;
	}

	if (!parseWidth(rawValue)) {
		console.warn("Ignoring invalid space panel width storage entry.", {
			storageKey,
		});
		removeBrowserPreference(storageKey);
		return metrics.defaultWidth;
	}

	const width = clampSpacePanelWidth({
		panel: input.panel,
		width: rawValue,
	});
	if (width !== rawValue) {
		writeBrowserPreference(storageKey, width);
	}
	return width;
}

export function writeSpacePanelWidth(
	input: {
		width: string;
	} & SpacePanelWidthPreference
): string {
	const width = clampSpacePanelWidth(input);
	writeBrowserPreference(resolveSpacePanelWidthStorageKey(input), width);
	return width;
}

export function resolveSpacePanelWidthStorageKey(
	input: SpacePanelWidthPreference
): string {
	const panelStorageKey = `openmeld.space.panel-width:${input.panel}`;
	if (input.panel === "thread") {
		return panelStorageKey;
	}

	const spaceId = input.spaceId.trim();
	if (!spaceId) {
		throw new Error("Space members panel width storage requires a space id.");
	}

	return `${panelStorageKey}:${spaceId}`;
}

function parseWidth(
	width: string
): { unit: "px" | "rem"; valuePx: number } | null {
	const match = WIDTH_PATTERN.exec(width.trim());
	if (!match) {
		return null;
	}

	const numericValue = Number.parseFloat(match[1] ?? "");
	const unit = match[2];
	if (!Number.isFinite(numericValue) || (unit !== "px" && unit !== "rem")) {
		return null;
	}

	return {
		unit,
		valuePx: unit === "rem" ? numericValue * PX_PER_REM : numericValue,
	};
}

function widthToPx(width: string): number {
	const parsed = parseWidth(width);
	if (!parsed) {
		throw new Error(`Invalid space panel width metric: ${width}`);
	}
	return parsed.valuePx;
}

function formatNumber(value: number): string {
	return value.toFixed(3).replace(TRAILING_ZERO_PATTERN, "");
}
