import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CompleteOnboardingDemo } from "./complete-onboarding-demo";

afterEach(cleanup);

describe("CompleteOnboardingDemo", () => {
	it("does not present skipped connections as completed setup", () => {
		render(
			<CompleteOnboardingDemo
				state={{
					appNames: [],
					channelNames: [],
					computerName: null,
					invitationCount: 0,
					isPersonal: false,
					localAgentNames: [],
					memoryEnabled: true,
					organizationId: "org_acme",
					organizationName: "Acme",
				}}
			/>
		);

		expect(screen.queryByText("Slack")).toBeNull();
		expect(screen.queryByText("GitHub")).toBeNull();
		expect(screen.queryByText("Connected")).toBeNull();
		expect(screen.getByText("Channels")).not.toBeNull();
		expect(screen.getByText("Apps")).not.toBeNull();
		expect(screen.getAllByText("Add when ready")).toHaveLength(2);
		expect(screen.getByText("Connect when ready")).not.toBeNull();
	});

	it("shows only the connections present in the completed setup state", () => {
		render(
			<CompleteOnboardingDemo
				state={{
					appNames: ["GitHub"],
					channelNames: ["Slack"],
					computerName: "Felix’s Mac",
					invitationCount: 2,
					isPersonal: false,
					localAgentNames: ["Codex"],
					memoryEnabled: true,
					organizationId: "org_acme",
					organizationName: "Acme",
				}}
			/>
		);

		expect(screen.getByText("Slack")).not.toBeNull();
		expect(screen.getByText("Connected")).not.toBeNull();
		expect(screen.getByText("GitHub")).not.toBeNull();
		expect(screen.getByText("Context ready")).not.toBeNull();
		expect(screen.getAllByText("Codex").length).toBeGreaterThan(0);
		expect(screen.getByText("2 invited")).not.toBeNull();
		expect(screen.queryByText("Add when ready")).toBeNull();
		expect(screen.queryByText("Connect when ready")).toBeNull();
	});

	it("uses personal copy when the selected workspace is private", () => {
		render(
			<CompleteOnboardingDemo
				state={{
					appNames: ["GitHub"],
					channelNames: [],
					computerName: "Felix’s Mac",
					invitationCount: 0,
					isPersonal: true,
					localAgentNames: ["Codex"],
					memoryEnabled: true,
					organizationId: "org_personal",
					organizationName: "Felix's Workspace",
				}}
			/>
		);

		expect(screen.getByText("Your apps and agents are ready.")).not.toBeNull();
		expect(screen.getByText("You")).not.toBeNull();
		expect(screen.queryByText("Your team")).toBeNull();
		expect(screen.queryByText("Channels")).toBeNull();
	});

	it("does not claim skipped personal connections are ready", () => {
		render(
			<CompleteOnboardingDemo
				state={{
					appNames: [],
					channelNames: [],
					computerName: null,
					invitationCount: 0,
					isPersonal: true,
					localAgentNames: [],
					memoryEnabled: true,
					organizationId: "org_personal",
					organizationName: "Felix's Workspace",
				}}
			/>
		);

		expect(
			screen.getByText("Your personal workspace is ready.")
		).not.toBeNull();
		expect(screen.queryByText("Your apps and agents are ready.")).toBeNull();
		expect(screen.queryByText("Channels")).toBeNull();
	});
});
