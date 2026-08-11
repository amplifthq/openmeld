import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StartSetupCommandCard } from "#/components/connect/start-setup-command-card";

describe("StartSetupCommandCard", () => {
	afterEach(() => {
		cleanup();
	});

	it("copies from both the command box and the copy button", async () => {
		const onCopyCommand = vi.fn().mockResolvedValue(undefined);
		const command = "openmeld-dev setup --start-session starttok_demo";

		render(
			<StartSetupCommandCard
				command={command}
				commandPlaceholder="Generating the setup command..."
				copyLabel="Copy setup command"
				copyStatus="idle"
				expiresInLabel={null}
				isLoading={false}
				onCopyCommand={onCopyCommand}
			/>
		);

		fireEvent.click(screen.getByRole("button", { name: command }));
		await waitFor(() => {
			expect(onCopyCommand).toHaveBeenCalledTimes(1);
		});

		fireEvent.click(screen.getByRole("button", { name: "Copy setup command" }));
		await waitFor(() => {
			expect(onCopyCommand).toHaveBeenCalledTimes(2);
		});

		const commandBox = screen.getByRole("button", { name: command });
		expect(commandBox.className).toContain("lg:max-w-[50vw]");
		expect(commandBox.className).toContain("whitespace-nowrap");
		expect(commandBox.className).toContain("overflow-x-auto");
		expect(commandBox.className).toContain("rounded-md");
		expect(commandBox.className).not.toContain("min-h-20");
	});

	it("shows a check icon with the copied state", () => {
		render(
			<StartSetupCommandCard
				command="openmeld-dev setup --start-session starttok_demo"
				commandPlaceholder="Generating the setup command..."
				copyLabel="Copy setup command"
				copyStatus="copied"
				expiresInLabel={null}
				isLoading={false}
				onCopyCommand={vi.fn().mockResolvedValue(undefined)}
			/>
		);

		const copiedButton = screen.getByRole("button", { name: "Copied" });

		expect(
			copiedButton.querySelector('[data-icon="inline-start"]')
		).toBeTruthy();
	});

	it("keeps the waiting status shimmer when requested", () => {
		render(
			<StartSetupCommandCard
				command="openmeld-dev setup --start-session starttok_demo"
				commandPlaceholder="Generating the setup command..."
				copyLabel="Copy setup command"
				copyStatus="idle"
				expiresInLabel="Command expires in 01:53."
				isLoading={false}
				onCopyCommand={vi.fn().mockResolvedValue(undefined)}
				secondaryStatusText="Last checked just now."
				statusText="Run the command in Terminal. OpenMeld is waiting for this computer..."
				statusTextIsShimmering={true}
			/>
		);

		const statusText = screen.getByText(
			"Run the command in Terminal. OpenMeld is waiting for this computer..."
		);

		expect(statusText.className).toContain("text-transparent");
		expect(screen.getByText("Last checked just now.")).toBeTruthy();
	});

	it("shows a refresh action when the setup command expired", async () => {
		const onRefreshExpiredCommand = vi.fn().mockResolvedValue(undefined);

		render(
			<StartSetupCommandCard
				command="openmeld-dev setup --start-session preptok_demo"
				commandPlaceholder="Generating the setup command..."
				copyLabel="Copy setup command"
				copyStatus="idle"
				expiresInLabel="Setup command expired."
				expiresInState="expired"
				isLoading={false}
				onCopyCommand={vi.fn().mockResolvedValue(undefined)}
				onRefreshExpiredCommand={onRefreshExpiredCommand}
			/>
		);

		expect(screen.getByText("Setup command expired.")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Refresh command" }));
		await waitFor(() => {
			expect(onRefreshExpiredCommand).toHaveBeenCalledTimes(1);
		});
	});
});
