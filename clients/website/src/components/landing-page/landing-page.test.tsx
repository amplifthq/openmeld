import { render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { LandingPage } from "./landing-page";

it("serves useful FAQ answers and guide links before JavaScript runs", () => {
	const html = renderToStaticMarkup(<LandingPage />);
	const document = new DOMParser().parseFromString(html, "text/html");
	expect(document.body.textContent).toContain(
		"You can self-host OpenMeld using the source code available under the MIT license."
	);
	expect(document.body.textContent).toContain(
		"Your computer must be online and connected for its local agents to work."
	);
	expect(
		document.querySelector(
			'a[href="https://docs.openmeld.ai/docs/start/quickstart"]'
		)
	).not.toBeNull();
	const trigger = Array.from(document.querySelectorAll("button")).find(
		(button) => button.textContent === "Can I self-host OpenMeld?"
	);
	expect(trigger?.getAttribute("aria-expanded")).toBe("false");
	const answer = Array.from(document.querySelectorAll('[role="region"]')).find(
		(panel) => panel.getAttribute("aria-labelledby") === trigger?.id
	);
	expect(answer?.textContent).toContain("You can self-host OpenMeld");
	expect(answer?.hasAttribute("hidden")).toBe(true);
});

it("sends application actions across the App boundary and keeps public guides on the website", () => {
	render(<LandingPage />);
	for (const link of screen.getAllByRole("link", {
		name: "Open App Web",
	})) {
		expect(link.getAttribute("href")).toBe("https://app.openmeld.ai/");
	}
	for (const link of screen.getAllByRole("link", { name: "Downloads" })) {
		expect(link.getAttribute("href")).toBe("/downloads");
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
