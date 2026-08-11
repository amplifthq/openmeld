import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useStartSetupCommandWatcher } from "./use-start-setup-command-watcher";

function TestHarness(input: {
	enabled: boolean;
	isExpired: boolean;
	onCheckNow: () => Promise<void>;
	stopWhen: boolean;
}) {
	const watcher = useStartSetupCommandWatcher(input);

	return (
		<div>
			<p>{watcher.isWatching ? "watching" : "not watching"}</p>
			<p>{watcher.isChecking ? "checking" : "not checking"}</p>
			<p>{watcher.statusText ?? "no status"}</p>
			<p>{watcher.lastCheckedAtMs === null ? "never checked" : "checked"}</p>
			<button onClick={watcher.checkNow} type="button">
				check now
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

function setDocumentVisibility(visibilityState: DocumentVisibilityState) {
	Object.defineProperty(document, "visibilityState", {
		configurable: true,
		value: visibilityState,
	});
	document.dispatchEvent(new Event("visibilitychange"));
}

describe("useStartSetupCommandWatcher", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-04-21T00:00:00.000Z"));
		setDocumentVisibility("visible");
	});

	afterEach(() => {
		cleanup();
		setDocumentVisibility("visible");
		vi.useRealTimers();
		vi.clearAllMocks();
	});

	it("starts checking immediately and then uses the fast polling interval", async () => {
		const onCheckNow = vi.fn().mockResolvedValue(undefined);

		render(
			<TestHarness
				enabled
				isExpired={false}
				onCheckNow={onCheckNow}
				stopWhen={false}
			/>
		);

		await flushAsyncWork();

		expect(onCheckNow).toHaveBeenCalledTimes(1);
		expect(screen.getByText("checked")).toBeTruthy();

		await act(async () => {
			await vi.advanceTimersByTimeAsync(2000);
		});

		expect(onCheckNow).toHaveBeenCalledTimes(2);
	});

	it("switches to the slower polling interval after the first 30 seconds", async () => {
		const onCheckNow = vi.fn().mockResolvedValue(undefined);

		render(
			<TestHarness
				enabled
				isExpired={false}
				onCheckNow={onCheckNow}
				stopWhen={false}
			/>
		);

		await flushAsyncWork();

		await act(async () => {
			await vi.advanceTimersByTimeAsync(30_000);
		});
		const callsAfterFastWindow = onCheckNow.mock.calls.length;

		await act(async () => {
			await vi.advanceTimersByTimeAsync(4000);
		});
		expect(onCheckNow).toHaveBeenCalledTimes(callsAfterFastWindow);

		await act(async () => {
			await vi.advanceTimersByTimeAsync(1000);
		});
		expect(onCheckNow).toHaveBeenCalledTimes(callsAfterFastWindow + 1);
	});

	it("does not check after the command expires", async () => {
		const onCheckNow = vi.fn().mockResolvedValue(undefined);

		render(
			<TestHarness enabled isExpired onCheckNow={onCheckNow} stopWhen={false} />
		);

		await flushAsyncWork();
		await act(async () => {
			await vi.advanceTimersByTimeAsync(5000);
		});

		expect(onCheckNow).not.toHaveBeenCalled();
		expect(
			screen.getByText(
				"This command expired. Copy a fresh command before running it."
			)
		).toBeTruthy();
	});

	it("pauses while the page is hidden and checks immediately when visible again", async () => {
		const onCheckNow = vi.fn().mockResolvedValue(undefined);

		render(
			<TestHarness
				enabled
				isExpired={false}
				onCheckNow={onCheckNow}
				stopWhen={false}
			/>
		);

		await flushAsyncWork();
		expect(onCheckNow).toHaveBeenCalledTimes(1);

		act(() => {
			setDocumentVisibility("hidden");
		});
		await act(async () => {
			await vi.advanceTimersByTimeAsync(10_000);
		});
		expect(onCheckNow).toHaveBeenCalledTimes(1);

		act(() => {
			setDocumentVisibility("visible");
		});
		await flushAsyncWork();

		expect(onCheckNow).toHaveBeenCalledTimes(2);
	});

	it("checks immediately when the user clicks Check now", async () => {
		const onCheckNow = vi.fn().mockResolvedValue(undefined);

		render(
			<TestHarness
				enabled
				isExpired={false}
				onCheckNow={onCheckNow}
				stopWhen={false}
			/>
		);

		await flushAsyncWork();
		onCheckNow.mockClear();

		fireEvent.click(screen.getByRole("button", { name: "check now" }));
		await flushAsyncWork();

		expect(onCheckNow).toHaveBeenCalledTimes(1);
	});

	it("allows Check now without starting automatic polling", async () => {
		const onCheckNow = vi.fn().mockResolvedValue(undefined);

		render(
			<TestHarness
				enabled={false}
				isExpired={false}
				onCheckNow={onCheckNow}
				stopWhen={false}
			/>
		);

		await flushAsyncWork();
		expect(onCheckNow).not.toHaveBeenCalled();
		expect(screen.getByText("not watching")).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: "check now" }));
		await flushAsyncWork();

		expect(onCheckNow).toHaveBeenCalledTimes(1);
	});

	it("stops when the surrounding start step changes", async () => {
		const onCheckNow = vi.fn().mockResolvedValue(undefined);
		const view = render(
			<TestHarness
				enabled
				isExpired={false}
				onCheckNow={onCheckNow}
				stopWhen={false}
			/>
		);

		await flushAsyncWork();
		expect(onCheckNow).toHaveBeenCalledTimes(1);

		view.rerender(
			<TestHarness enabled isExpired={false} onCheckNow={onCheckNow} stopWhen />
		);
		await flushAsyncWork();
		await act(async () => {
			await vi.advanceTimersByTimeAsync(5000);
		});

		expect(onCheckNow).toHaveBeenCalledTimes(1);
		expect(screen.getByText("not watching")).toBeTruthy();
	});
});
