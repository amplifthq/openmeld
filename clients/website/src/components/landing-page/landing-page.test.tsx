import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { LandingPage } from "./landing-page";

it("sends application actions across the App boundary and keeps public guides on the website", () => {
	render(<LandingPage />);
	expect(
		screen.getByRole("link", { name: "Open app" }).getAttribute("href")
	).toBe("https://app.openmeld.ai/");
	for (const link of screen.getAllByRole("link", {
		name: "Start with OpenMeld",
	})) {
		expect(link.getAttribute("href")).toBe("https://app.openmeld.ai/");
	}
	for (const link of screen.getAllByRole("link", { name: "Add to Slack" })) {
		expect(link.getAttribute("href")).toBe(
			"https://app.openmeld.ai/add-to-slack"
		);
	}
	expect(
		screen.getByRole("link", { name: "Setup guide" }).getAttribute("href")
	).toBe("/guides/local-agents");
});
