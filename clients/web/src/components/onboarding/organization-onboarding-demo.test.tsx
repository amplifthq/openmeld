import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { OrganizationOnboardingDemo } from "./organization-onboarding-demo";

describe("OrganizationOnboardingDemo", () => {
	afterEach(cleanup);

	it("shows the selected organization's logo", () => {
		render(
			<OrganizationOnboardingDemo
				organization={{
					id: "org-amplift",
					isPersonal: false,
					logo: "https://gateway.example/amplift.webp",
					name: "Amplift",
				}}
				people={[
					{ id: "user-1", image: null, name: "Felix Chen" },
					{ id: "user-2", image: null, name: "Alice Morgan" },
					{ id: "user-3", image: null, name: "James Lee" },
				]}
			/>
		);

		expect(screen.getByText("Amplift")).toBeTruthy();
		expect(screen.getByText("Felix")).toBeTruthy();
		expect(screen.getByText("Alice")).toBeTruthy();
		expect(screen.getByText("James")).toBeTruthy();
		expect(screen.getByText("Shared with your team")).toBeTruthy();
		expect(screen.queryByText("One shared loop")).toBeNull();
		expect(screen.queryByText("AM")).toBeNull();
		expect(document.querySelector("img")?.getAttribute("src")).toBe(
			"https://gateway.example/amplift.webp"
		);
	});

	it("falls back to the organization's initials when it has no logo", () => {
		render(
			<OrganizationOnboardingDemo
				organization={{
					id: "org-openmeld",
					isPersonal: false,
					logo: null,
					name: "OpenMeld Official",
				}}
				people={[{ id: "user-1", image: null, name: "Felix Chen" }]}
			/>
		);

		expect(screen.getByText("OO")).toBeTruthy();
	});

	it("shows one real person and clear privacy copy for Personal Workspace", () => {
		render(
			<OrganizationOnboardingDemo
				organization={{
					id: "org-personal",
					isPersonal: true,
					logo: null,
					name: "Personal Workspace",
				}}
				people={[
					{ id: "user-1", image: null, name: "Felix Chen" },
					{ id: "user-2", image: null, name: "Alice Morgan" },
				]}
			/>
		);

		expect(screen.getByText("Felix")).toBeTruthy();
		expect(screen.queryByText("Alice")).toBeNull();
		expect(screen.getByText("Private to you")).toBeTruthy();
		expect(screen.queryByText("People · context · agents")).toBeNull();
	});

	it("does not invent a person when real account data is unavailable", () => {
		render(
			<OrganizationOnboardingDemo
				organization={{
					id: "org-personal",
					isPersonal: true,
					logo: null,
					name: "Personal Workspace",
				}}
				people={[]}
			/>
		);

		expect(screen.queryByText("You")).toBeNull();
	});
});
