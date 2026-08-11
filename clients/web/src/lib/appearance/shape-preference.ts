import {
	DEFAULT_ROUNDED_SHAPE_RADIUS_PX,
	type ShapeVariant,
} from "@openmeld/ui/lib/shape-context";

const LEGACY_APPEARANCE_SHAPE_STORAGE_KEY = "openmeld.appearance.shape";
export const APPEARANCE_SHAPE_STORAGE_KEY = "openmeld.appearance.shape.v2";
export const APPEARANCE_SHAPE_ATTRIBUTE = "data-ui-shape";
export const DEFAULT_APPEARANCE_SHAPE: ShapeVariant = "rounded";
const APPEARANCE_SHAPE_CHANGE_EVENT = "openmeld:appearance-shape-change";

export function readAppearanceShapePreference(): ShapeVariant {
	if (typeof window === "undefined") {
		return DEFAULT_APPEARANCE_SHAPE;
	}

	try {
		window.localStorage.removeItem(LEGACY_APPEARANCE_SHAPE_STORAGE_KEY);
		const storedValue = window.localStorage.getItem(
			APPEARANCE_SHAPE_STORAGE_KEY
		);
		if (!storedValue) {
			return DEFAULT_APPEARANCE_SHAPE;
		}
		if (isAppearanceShape(storedValue)) {
			return storedValue;
		}

		console.warn("Ignoring invalid interface corner style preference.", {
			storageKey: APPEARANCE_SHAPE_STORAGE_KEY,
			storedValue,
		});
		window.localStorage.removeItem(APPEARANCE_SHAPE_STORAGE_KEY);
	} catch (error) {
		console.warn("Interface corner style storage is unavailable.", {
			errorName: resolveErrorName(error),
			operation: "read",
			storageKey: APPEARANCE_SHAPE_STORAGE_KEY,
		});
	}

	return DEFAULT_APPEARANCE_SHAPE;
}

export function writeAppearanceShapePreference(shape: ShapeVariant): void {
	applyAppearanceShapeToDocument(shape);
	if (typeof window === "undefined") {
		return;
	}

	try {
		window.localStorage.setItem(APPEARANCE_SHAPE_STORAGE_KEY, shape);
	} catch (error) {
		console.warn("Interface corner style storage is unavailable.", {
			errorName: resolveErrorName(error),
			operation: "write",
			storageKey: APPEARANCE_SHAPE_STORAGE_KEY,
		});
	}

	window.dispatchEvent(new Event(APPEARANCE_SHAPE_CHANGE_EVENT));
}

export function subscribeToAppearanceShapePreference(
	onStoreChange: () => void
): () => void {
	if (typeof window === "undefined") {
		return () => undefined;
	}

	const syncShapeFromAnotherTab = (event: StorageEvent) => {
		if (event.key !== APPEARANCE_SHAPE_STORAGE_KEY) {
			return;
		}
		applyAppearanceShapeToDocument(readAppearanceShapePreference());
		onStoreChange();
	};

	window.addEventListener("storage", syncShapeFromAnotherTab);
	window.addEventListener(APPEARANCE_SHAPE_CHANGE_EVENT, onStoreChange);
	return () => {
		window.removeEventListener("storage", syncShapeFromAnotherTab);
		window.removeEventListener(APPEARANCE_SHAPE_CHANGE_EVENT, onStoreChange);
	};
}

function isAppearanceShape(value: string): value is ShapeVariant {
	return value === "rounded" || value === "square";
}

function resolveErrorName(error: unknown): string {
	if (error instanceof Error && error.name.trim()) {
		return error.name;
	}
	return "UnknownError";
}

function applyAppearanceShapeToDocument(shape: ShapeVariant): void {
	if (typeof document !== "undefined") {
		document.documentElement.setAttribute(APPEARANCE_SHAPE_ATTRIBUTE, shape);
		document.documentElement.style.setProperty(
			"--radius",
			`${shape === "rounded" ? DEFAULT_ROUNDED_SHAPE_RADIUS_PX : 0}px`
		);
	}
}

export const APPEARANCE_SHAPE_BOOTSTRAP_SCRIPT = `(() => {
	const root = document.documentElement;
	const attribute = ${JSON.stringify(APPEARANCE_SHAPE_ATTRIBUTE)};
	const storageKey = ${JSON.stringify(APPEARANCE_SHAPE_STORAGE_KEY)};
	const legacyStorageKey = ${JSON.stringify(LEGACY_APPEARANCE_SHAPE_STORAGE_KEY)};
	const fallback = ${JSON.stringify(DEFAULT_APPEARANCE_SHAPE)};
	const roundedRadiusPx = ${JSON.stringify(DEFAULT_ROUNDED_SHAPE_RADIUS_PX)};
	try {
		window.localStorage.removeItem(legacyStorageKey);
		const storedValue = window.localStorage.getItem(storageKey);
		const shape = storedValue === "rounded" || storedValue === "square"
			? storedValue
			: fallback;
		root.setAttribute(attribute, shape);
		root.style.setProperty(
			"--radius",
			String(shape === "rounded" ? roundedRadiusPx : 0) + "px"
		);
		if (storedValue && storedValue !== shape) {
			console.warn("Ignoring invalid interface corner style preference.", {
				storageKey,
				storedValue,
			});
			window.localStorage.removeItem(storageKey);
		}
	} catch (error) {
		root.setAttribute(attribute, fallback);
		root.style.setProperty(
			"--radius",
			String(fallback === "rounded" ? roundedRadiusPx : 0) + "px"
		);
		console.warn("Failed to restore the interface corner style preference.", error);
	}
})();`;
