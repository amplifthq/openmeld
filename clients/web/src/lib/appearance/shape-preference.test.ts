import { DEFAULT_ROUNDED_SHAPE_RADIUS_PX } from "@openmeld/ui/lib/shape-context";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	APPEARANCE_SHAPE_ATTRIBUTE,
	APPEARANCE_SHAPE_BOOTSTRAP_SCRIPT,
	APPEARANCE_SHAPE_STORAGE_KEY,
	DEFAULT_APPEARANCE_SHAPE,
	readAppearanceShapePreference,
	writeAppearanceShapePreference,
} from "./shape-preference";

describe("Appearance shape preference", () => {
	afterEach(() => {
		window.localStorage.clear();
		document.documentElement.removeAttribute(APPEARANCE_SHAPE_ATTRIBUTE);
		document.documentElement.style.removeProperty("--radius");
		vi.restoreAllMocks();
	});

	it("defaults to rounded with Linear's control radius", () => {
		expect(readAppearanceShapePreference()).toBe(DEFAULT_APPEARANCE_SHAPE);
		expect(DEFAULT_APPEARANCE_SHAPE).toBe("rounded");
		expect(DEFAULT_ROUNDED_SHAPE_RADIUS_PX).toBe(8);
	});

	it("migrates every legacy preference to the new rounded default", () => {
		window.localStorage.setItem("openmeld.appearance.shape", "square");

		expect(readAppearanceShapePreference()).toBe("rounded");
		expect(window.localStorage.getItem("openmeld.appearance.shape")).toBeNull();
		expect(
			window.localStorage.getItem(APPEARANCE_SHAPE_STORAGE_KEY)
		).toBeNull();
	});

	it("persists and applies a rounded preference to the document root", () => {
		writeAppearanceShapePreference("rounded");

		expect(window.localStorage.getItem(APPEARANCE_SHAPE_STORAGE_KEY)).toBe(
			"rounded"
		);
		expect(
			document.documentElement.getAttribute(APPEARANCE_SHAPE_ATTRIBUTE)
		).toBe("rounded");
		expect(document.documentElement.style.getPropertyValue("--radius")).toBe(
			`${DEFAULT_ROUNDED_SHAPE_RADIUS_PX}px`
		);
		expect(readAppearanceShapePreference()).toBe("rounded");
	});

	it("restores the square root radius when the preference changes back", () => {
		writeAppearanceShapePreference("rounded");
		writeAppearanceShapePreference("square");

		expect(document.documentElement.style.getPropertyValue("--radius")).toBe(
			"0px"
		);
	});

	it("removes an invalid stored value and falls back to rounded", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		window.localStorage.setItem(APPEARANCE_SHAPE_STORAGE_KEY, "soft");

		expect(readAppearanceShapePreference()).toBe("rounded");
		expect(
			window.localStorage.getItem(APPEARANCE_SHAPE_STORAGE_KEY)
		).toBeNull();
		expect(warn).toHaveBeenCalledOnce();
	});

	it("publishes a bootstrap script that restores shape before the app renders", () => {
		expect(APPEARANCE_SHAPE_BOOTSTRAP_SCRIPT).toContain(
			APPEARANCE_SHAPE_STORAGE_KEY
		);
		expect(APPEARANCE_SHAPE_BOOTSTRAP_SCRIPT).toContain(
			APPEARANCE_SHAPE_ATTRIBUTE
		);
		expect(APPEARANCE_SHAPE_BOOTSTRAP_SCRIPT).toContain("rounded");
		expect(APPEARANCE_SHAPE_BOOTSTRAP_SCRIPT).toContain("square");
	});
});
