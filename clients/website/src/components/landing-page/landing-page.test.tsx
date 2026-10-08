import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { LandingPage } from "./landing-page";

it("sends application actions across the App boundary and keeps public guides on the website", () => {
	render(<LandingPage />);
	for (const link of screen.getAllByRole("link", {
		name: "Open App Web",
	})) {
		expect(link.getAttribute("href")).toBe("https://app.openmeld.ai/");
	}
	expect(
		screen.getByRole("link", { name: "Downloads" }).getAttribute("href")
	).toBe("https://app.openmeld.ai/desktop");
	for (const link of screen.getAllByRole("link", { name: "Add to Slack" })) {
		expect(link.getAttribute("href")).toBe(
			"https://app.openmeld.ai/add-to-slack"
		);
	}
	expect(
		screen.getByRole("link", { name: "Setup guide" }).getAttribute("href")
	).toBe("/guides/local-agents");
});
