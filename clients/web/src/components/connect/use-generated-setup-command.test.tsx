import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useGeneratedSetupCommand } from "./use-generated-setup-command";

const copyCliEntryCommandMock = vi.hoisted(() => vi.fn());
const generateOneTimeTokenMutateAsyncMock = vi.hoisted(() => vi.fn());
const useGenerateOneTimeTokenMock = vi.hoisted(() => vi.fn());

vi.mock("#/hooks/account.hooks", () => ({
	useGenerateOneTimeToken: useGenerateOneTimeTokenMock,
}));

vi.mock("#/lib/cli-entry-command", () => ({
	copyCliEntryCommand: copyCliEntryCommandMock,
}));

function TestHarness(input: {
	buildCommand: (oneTimeToken: string) => Promise<null | string>;
	commandKey?: string | null;
	enabled: boolean;
	errorMessage: string;
}) {
	const generatedCommand = useGeneratedSetupCommand({
		...input,
		commandKey:
			input.commandKey === undefined ? "test-command" : input.commandKey,
	});

	return (
		<div>
			<p>{generatedCommand.command ?? "no command"}</p>
			<p>{generatedCommand.expiresInLabel ?? "no expiry"}</p>
			<p>
				{generatedCommand.hasCommand ? "has command" : "no generated command"}
			</p>
			<p>
				{generatedCommand.hasSetupAttemptStarted
					? "attempt started"
					: "attempt not started"}
			</p>
			<p>{generatedCommand.isExpired ? "expired" : "not expired"}</p>
			<p>
				{generatedCommand.remainingSeconds === null
					? "no remaining seconds"
					: `${generatedCommand.remainingSeconds} seconds remaining`}
			</p>
			<button onClick={generatedCommand.copyCommand} type="button">
				copy command
			</button>
			<button onClick={generatedCommand.refreshAndCopyCommand} type="button">
				refresh and copy command
			</button>
		</div>
	);
}

async function flushAsyncWork() {
	await act(async () => {
		await Promise.resolve();
		await Promise.resolve();
	});
}

function createDeferred<T>() {
	let resolve: (value: T) => void = () => undefined;
	let reject: (error: unknown) => void = () => undefined;
	const promise = new Promise<T>((nextResolve, nextReject) => {
		resolve = nextResolve;
		reject = nextReject;
	});
	return { promise, reject, resolve };
}

describe("useGeneratedSetupCommand", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-04-21T00:00:00.000Z"));
		copyCliEntryCommandMock.mockReset().mockResolvedValue(true);
		generateOneTimeTokenMutateAsyncMock.mockReset().mockResolvedValue({
			token: "ott_demo",
			expiresIn: 180,
		});
		useGenerateOneTimeTokenMock.mockReset().mockImplementation(() => ({
			mutateAsync: generateOneTimeTokenMutateAsyncMock,
			isPending: false,
		}));
	});

	afterEach(() => {
		cleanup();
		vi.useRealTimers();
		vi.clearAllMocks();
	});

	it("auto-refreshes only once on first load even when mutateAsync changes between renders", async () => {
		const buildCommand = vi
			.fn<(oneTimeToken: string) => Promise<string>>()
			.mockImplementation(
				async (oneTimeToken) => `openmeld setup --ott ${oneTimeToken}`
			);

		useGenerateOneTimeTokenMock.mockImplementation(() => ({
			mutateAsync: async () => await generateOneTimeTokenMutateAsyncMock(),
			isPending: false,
		}));

		render(
			<TestHarness
				buildCommand={buildCommand}
				enabled
				errorMessage="OpenMeld could not load the command."
			/>
		);

		await flushAsyncWork();

		expect(screen.getByText("openmeld setup --ott ott_demo")).toBeTruthy();
		expect(screen.getByText("has command")).toBeTruthy();
		expect(screen.getByText("attempt not started")).toBeTruthy();
		expect(generateOneTimeTokenMutateAsyncMock).toHaveBeenCalledTimes(1);

		await act(() => {
			vi.advanceTimersByTime(5000);
		});

		expect(screen.getByText("Command expires in 02:55.")).toBeTruthy();
		expect(generateOneTimeTokenMutateAsyncMock).toHaveBeenCalledTimes(1);
		expect(buildCommand).toHaveBeenCalledTimes(1);
	});

	it("retries automatically when the command becomes available after a rerender", async () => {
		const unavailableBuildCommand = vi
			.fn<(oneTimeToken: string) => Promise<null>>()
			.mockResolvedValue(null);
		const availableBuildCommand = vi
			.fn<(oneTimeToken: string) => Promise<string>>()
			.mockImplementation(
				async (oneTimeToken) => `openmeld setup --ott ${oneTimeToken}`
			);

		const { rerender } = render(
			<TestHarness
				buildCommand={unavailableBuildCommand}
				commandKey="command-unavailable"
				enabled
				errorMessage="OpenMeld could not load the command."
			/>
		);

		await flushAsyncWork();

		expect(screen.getByText("no command")).toBeTruthy();
		expect(unavailableBuildCommand).toHaveBeenCalledTimes(1);
		expect(generateOneTimeTokenMutateAsyncMock).toHaveBeenCalledTimes(1);

		rerender(
			<TestHarness
				buildCommand={availableBuildCommand}
				commandKey="command-available"
				enabled
				errorMessage="OpenMeld could not load the command."
			/>
		);

		await flushAsyncWork();

		expect(screen.getByText("openmeld setup --ott ott_demo")).toBeTruthy();
		expect(availableBuildCommand).toHaveBeenCalledTimes(1);
		expect(generateOneTimeTokenMutateAsyncMock).toHaveBeenCalledTimes(2);
	});

	it("refreshes and recopies the latest command when the user asks for a fresh token", async () => {
		generateOneTimeTokenMutateAsyncMock
			.mockReset()
			.mockResolvedValueOnce({
				token: "ott_initial",
				expiresIn: 180,
			})
			.mockResolvedValueOnce({
				token: "ott_refreshed",
				expiresIn: 180,
			});

		const buildCommand = vi
			.fn<(oneTimeToken: string) => Promise<string>>()
			.mockImplementation(
				async (oneTimeToken) => `openmeld setup --ott ${oneTimeToken}`
			);

		render(
			<TestHarness
				buildCommand={buildCommand}
				enabled
				errorMessage="OpenMeld could not load the command."
			/>
		);

		await flushAsyncWork();
		expect(screen.getByText("openmeld setup --ott ott_initial")).toBeTruthy();

		fireEvent.click(
			screen.getByRole("button", {
				name: "copy command",
			})
		);

		await flushAsyncWork();
		expect(copyCliEntryCommandMock).toHaveBeenNthCalledWith(
			1,
			"openmeld setup --ott ott_initial"
		);
		expect(screen.getByText("attempt started")).toBeTruthy();

		fireEvent.click(
			screen.getByRole("button", {
				name: "refresh and copy command",
			})
		);

		await flushAsyncWork();
		expect(screen.getByText("openmeld setup --ott ott_refreshed")).toBeTruthy();
		expect(copyCliEntryCommandMock).toHaveBeenNthCalledWith(
			2,
			"openmeld setup --ott ott_refreshed"
		);
	});

	it("keeps the copied command stable when setup polling rerenders the command builder", async () => {
		generateOneTimeTokenMutateAsyncMock
			.mockReset()
			.mockResolvedValueOnce({
				token: "ott_initial",
				expiresIn: 180,
			})
			.mockResolvedValueOnce({
				token: "ott_replaced",
				expiresIn: 180,
			});

		const initialBuildCommand = vi
			.fn<(oneTimeToken: string) => Promise<string>>()
			.mockImplementation(
				async (oneTimeToken) => `openmeld setup --ott ${oneTimeToken}`
			);
		const pollingBuildCommand = vi
			.fn<(oneTimeToken: string) => Promise<string>>()
			.mockImplementation(
				async (oneTimeToken) => `openmeld setup --ott ${oneTimeToken}`
			);

		const { rerender } = render(
			<TestHarness
				buildCommand={initialBuildCommand}
				enabled
				errorMessage="OpenMeld could not load the command."
			/>
		);

		await flushAsyncWork();
		expect(screen.getByText("openmeld setup --ott ott_initial")).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: "copy command" }));
		await flushAsyncWork();

		rerender(
			<TestHarness
				buildCommand={pollingBuildCommand}
				enabled
				errorMessage="OpenMeld could not load the command."
			/>
		);
		await flushAsyncWork();

		expect(screen.getByText("openmeld setup --ott ott_initial")).toBeTruthy();
		expect(generateOneTimeTokenMutateAsyncMock).toHaveBeenCalledTimes(1);
		expect(initialBuildCommand).toHaveBeenCalledTimes(1);
		expect(pollingBuildCommand).not.toHaveBeenCalled();
		expect(copyCliEntryCommandMock).toHaveBeenCalledWith(
			"openmeld setup --ott ott_initial"
		);
	});

	it("reuses the in-flight refresh when enabled toggles off and back on before the refresh settles", async () => {
		const firstToken = createDeferred<{ expiresIn: number; token: string }>();
		generateOneTimeTokenMutateAsyncMock
			.mockReset()
			.mockImplementationOnce(() => firstToken.promise);

		const buildCommand = vi
			.fn<(oneTimeToken: string) => Promise<string>>()
			.mockImplementation(
				async (oneTimeToken) => `openmeld setup --ott ${oneTimeToken}`
			);

		const { rerender } = render(
			<TestHarness
				buildCommand={buildCommand}
				enabled
				errorMessage="OpenMeld could not load the command."
			/>
		);

		await flushAsyncWork();
		expect(generateOneTimeTokenMutateAsyncMock).toHaveBeenCalledTimes(1);

		rerender(
			<TestHarness
				buildCommand={buildCommand}
				enabled={false}
				errorMessage="OpenMeld could not load the command."
			/>
		);
		await flushAsyncWork();

		rerender(
			<TestHarness
				buildCommand={buildCommand}
				enabled
				errorMessage="OpenMeld could not load the command."
			/>
		);
		await flushAsyncWork();

		expect(generateOneTimeTokenMutateAsyncMock).toHaveBeenCalledTimes(1);

		firstToken.resolve({
			token: "ott_stable",
			expiresIn: 180,
		});
		await flushAsyncWork();

		expect(buildCommand).toHaveBeenCalledTimes(1);
		expect(screen.getByText("openmeld setup --ott ott_stable")).toBeTruthy();
	});

	it("marks a manual copy state as a started setup attempt", async () => {
		copyCliEntryCommandMock.mockResolvedValue(false);
		const buildCommand = vi
			.fn<(oneTimeToken: string) => Promise<string>>()
			.mockImplementation(
				async (oneTimeToken) => `openmeld setup --ott ${oneTimeToken}`
			);

		render(
			<TestHarness
				buildCommand={buildCommand}
				enabled
				errorMessage="OpenMeld could not load the command."
			/>
		);

		await flushAsyncWork();
		fireEvent.click(screen.getByRole("button", { name: "copy command" }));
		await flushAsyncWork();

		expect(copyCliEntryCommandMock).toHaveBeenCalledWith(
			"openmeld setup --ott ott_demo"
		);
		expect(screen.getByText("attempt started")).toBeTruthy();
	});

	it("reports expiration when the one-time token reaches zero seconds", async () => {
		generateOneTimeTokenMutateAsyncMock.mockResolvedValue({
			token: "ott_short",
			expiresIn: 1,
		});
		const buildCommand = vi
			.fn<(oneTimeToken: string) => Promise<string>>()
			.mockImplementation(
				async (oneTimeToken) => `openmeld setup --ott ${oneTimeToken}`
			);

		render(
			<TestHarness
				buildCommand={buildCommand}
				enabled
				errorMessage="OpenMeld could not load the command."
			/>
		);

		await flushAsyncWork();

		expect(screen.getByText("not expired")).toBeTruthy();

		await act(() => {
			vi.advanceTimersByTime(1000);
		});

		expect(screen.getByText("expired")).toBeTruthy();
		expect(
			screen.getByText(
				"This command expired. Copy a fresh command before running it."
			)
		).toBeTruthy();
		expect(screen.getByText("0 seconds remaining")).toBeTruthy();
	});
});
