import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AppMainContent } from "./app-main-content";

describe("AppMainContent", () => {
	it("hides an empty header strip from assistive technology", () => {
		const { container } = render(
			<AppMainContent>
				<div>Body</div>
			</AppMainContent>
		);

		const header = container.querySelector("header");
		expect(header?.tagName).toBe("HEADER");
		expect(header?.getAttribute("aria-hidden")).toBe("true");
		expect(screen.getByText("Body")).toBeTruthy();
	});

	it("renders provided header content in the shared header strip", () => {
		const { container } = render(
			<AppMainContent header={<h1>Space title</h1>}>
				<div>Conversation</div>
			</AppMainContent>
		);

		const header = container.querySelector("header");
		expect(header?.getAttribute("aria-hidden")).toBeNull();
		expect(
			screen.getByRole("heading", { level: 1, name: "Space title" })
		).toBeTruthy();
		expect(screen.getByText("Conversation")).toBeTruthy();
	});

	it("can omit the header strip for routes without contextual navigation", () => {
		const { container } = render(
			<AppMainContent showHeader={false}>
				<div>Projects</div>
			</AppMainContent>
		);

		expect(container.querySelector("header")).toBeNull();
		expect(screen.getByText("Projects")).toBeTruthy();
	});
});
