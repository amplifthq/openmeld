import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	selectLocalFolders,
	selectPeopleComputerFolders,
} from "#/lib/connect/local-folder-picker";
import { TestQueryClientProvider } from "#/test-support/query-client";
import { LocalFolderPickerButton } from "./local-folder-picker-button";

vi.mock("#/lib/connect/local-folder-picker", () => ({
	selectLocalFolders: vi.fn(),
	selectPeopleComputerFolders: vi.fn(),
}));

describe("LocalFolderPickerButton", () => {
	it("targets the selected environment and discards a late result after switching lanes on the same computer", async () => {
		let complete:
			| ((value: {
					deviceId: string;
					paths: string[];
					status: "selected";
			  }) => void)
			| undefined;
		vi.mocked(selectPeopleComputerFolders).mockReturnValue(
			new Promise((resolve) => {
				complete = resolve;
			})
		);
		const onSelect = vi.fn();
		const props = {
			allowMultiple: true,
			deviceId: "same-device",
			label: "Choose folders",
			onSelect,
			purpose: "computer_file_access" as const,
		};
		const view = render(
			<LocalFolderPickerButton {...props} runtimeLane="canary" />
		);
		fireEvent.click(screen.getByRole("button", { name: "Choose folders" }));
		expect(selectPeopleComputerFolders).toHaveBeenCalledWith({
			allowMultiple: true,
			deviceId: "same-device",
			runtimeLane: "canary",
			purpose: "computer_file_access",
			timeoutMs: 610_000,
		});
		expect(selectLocalFolders).not.toHaveBeenCalled();
		view.rerender(<LocalFolderPickerButton {...props} runtimeLane="prod" />);
		await act(() => {
			complete?.({
				deviceId: "same-device",
				status: "selected",
				paths: ["/test/canary-only"],
			});
		});
		expect(onSelect).not.toHaveBeenCalled();
	});
	afterEach(() => {
		cleanup();
		vi.clearAllMocks();
	});

	it("adds the selected local paths to the current draft", async () => {
		vi.mocked(selectLocalFolders).mockResolvedValue({
			deviceId: "device-current",
			paths: ["/Users/felix/Design Work"],
			status: "selected",
		});
		const onSelect = vi.fn();
		renderButton(onSelect);

		fireEvent.click(
			screen.getByRole("button", { name: "Choose folders on this computer" })
		);

		await waitFor(() =>
			expect(onSelect).toHaveBeenCalledWith(["/Users/felix/Design Work"])
		);
		expect(selectLocalFolders).toHaveBeenCalledWith({
			allowMultiple: true,
			expectedDeviceId: "device-current",
			purpose: "computer_file_access",
			timeoutMs: 610_000,
		});
	});

	it("keeps closing the system dialog as a quiet no-change action", async () => {
		vi.mocked(selectLocalFolders).mockResolvedValue({
			deviceId: "device-current",
			status: "cancelled",
		});
		const onSelect = vi.fn();
		renderButton(onSelect);

		fireEvent.click(
			screen.getByRole("button", { name: "Choose folders on this computer" })
		);

		await waitFor(() => expect(selectLocalFolders).toHaveBeenCalledOnce());
		expect(onSelect).not.toHaveBeenCalled();
		expect(screen.queryByRole("alert")).toBeNull();
	});

	it("shows one useful recovery action when the signed-in desktop session is unavailable", async () => {
		vi.mocked(selectLocalFolders).mockResolvedValue({
			code: "local.folder_picker.no_interactive_session",
			message: "Sign in to this Windows computer to choose a folder.",
			status: "unavailable",
		});
		renderButton(vi.fn());

		fireEvent.click(
			screen.getByRole("button", { name: "Choose folders on this computer" })
		);

		expect(
			await screen.findByText("Sign in to this computer, then try again.")
		).toBeTruthy();
	});

	it("ignores a late selection after the user switches Computers", async () => {
		let resolveSelection:
			| ((value: {
					deviceId: string;
					paths: string[];
					status: "selected";
			  }) => void)
			| undefined;
		vi.mocked(selectLocalFolders).mockReturnValue(
			new Promise((resolve) => {
				resolveSelection = resolve;
			})
		);
		const onSelect = vi.fn();
		const view = renderButton(onSelect);
		fireEvent.click(
			screen.getByRole("button", { name: "Choose folders on this computer" })
		);

		view.rerender(
			<TestQueryClientProvider>
				<LocalFolderPickerButton
					allowMultiple
					deviceId="device-other"
					label="Choose folders on this computer"
					onSelect={onSelect}
					purpose="computer_file_access"
				/>
			</TestQueryClientProvider>
		);
		await act(() => {
			resolveSelection?.({
				deviceId: "device-current",
				paths: ["/Users/felix/Old Computer"],
				status: "selected",
			});
		});

		expect(onSelect).not.toHaveBeenCalled();
	});
});

function renderButton(onSelect: (paths: readonly string[]) => void) {
	return render(
		<TestQueryClientProvider>
			<LocalFolderPickerButton
				allowMultiple
				deviceId="device-current"
				label="Choose folders on this computer"
				onSelect={onSelect}
				purpose="computer_file_access"
			/>
		</TestQueryClientProvider>
	);
}
