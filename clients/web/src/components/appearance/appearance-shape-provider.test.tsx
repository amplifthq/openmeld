import { useShapeContext } from "@openmeld/ui/lib/shape-context";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
	APPEARANCE_SHAPE_ATTRIBUTE,
	APPEARANCE_SHAPE_STORAGE_KEY,
} from "#/lib/appearance/shape-preference";
import { AppearanceShapeProvider } from "./appearance-shape-provider";

describe("AppearanceShapeProvider", () => {
	afterEach(() => {
		cleanup();
		window.localStorage.clear();
		document.documentElement.removeAttribute(APPEARANCE_SHAPE_ATTRIBUTE);
		document.documentElement.style.removeProperty("--radius");
	});

	it("restores the saved shape and persists changes from shared UI", async () => {
		window.localStorage.setItem(APPEARANCE_SHAPE_STORAGE_KEY, "rounded");

		render(
			<AppearanceShapeProvider>
				<ShapeConsumer />
			</AppearanceShapeProvider>
		);

		expect(await screen.findByText("rounded")).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: "Use square corners" }));

		expect(screen.getByText("square")).toBeTruthy();
		expect(window.localStorage.getItem(APPEARANCE_SHAPE_STORAGE_KEY)).toBe(
			"square"
		);
		expect(
			document.documentElement.getAttribute(APPEARANCE_SHAPE_ATTRIBUTE)
		).toBe("square");
		expect(document.documentElement.style.getPropertyValue("--radius")).toBe(
			"0px"
		);
	});
});

function ShapeConsumer() {
	const { setShape, shape } = useShapeContext();

	return (
		<>
			<span>{shape}</span>
			<button onClick={() => setShape("square")} type="button">
				Use square corners
			</button>
		</>
	);
}
