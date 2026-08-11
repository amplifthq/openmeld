import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CenterAgentSlackConnectionDialog } from "./center-agent-slack-connection-dialog";

afterEach(cleanup);

describe("CenterAgentSlackConnectionDialog", () => {
	it("describes the same open conversation boundary before connection", () => {
		render(
			<CenterAgentSlackConnectionDialog
				canManage={true}
				trigger={<button type="button">Connect Slack</button>}
			/>
		);

		fireEvent.click(screen.getByRole("button", { name: "Connect Slack" }));

		expect(
			screen.getByText(
				"Connect the workspace here. Anyone in it can talk to the Center Agent. OpenMeld sign-in is only needed for private context or authorized actions."
			)
		).toBeTruthy();
	});

	it("explains that Slack workspace participants can talk before linking", () => {
		render(
			<CenterAgentSlackConnectionDialog
				canManage
				slackConnection={{
					connected: true,
					slackTeamId: "T123",
					workspaceName: "Acme HQ",
				}}
				trigger={<button type="button">Manage Slack</button>}
			/>
		);

		fireEvent.click(screen.getByRole("button", { name: "Manage Slack" }));

		expect(
			screen.getByText(
				"OpenMeld sign-in is only required when someone asks for private organization context or an authorized action."
			)
		).toBeTruthy();
		expect(screen.getByText("Acme HQ")).toBeTruthy();
		expect(screen.queryByText("Connected to Acme HQ")).toBeNull();
		expect(screen.queryByText("Workspace ID: T123")).toBeNull();
		expect(
			screen.getByRole("button", { name: "Disconnect Slack" })
		).toBeTruthy();
	});
});
