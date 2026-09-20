import { describe, expect, it, vi } from "vitest";
import { createSpaceInboxReadThroughCoordinator } from "./space-inbox-read-through-coordinator";

describe("createSpaceInboxReadThroughCoordinator", () => {
	it("serializes a scope and coalesces queued read positions", async () => {
		let finishFirstWrite: (() => void) | undefined;
		const write = vi
			.fn<(input: { throughOccurredAtMs: number }) => Promise<void>>()
			.mockImplementationOnce(
				() =>
					new Promise<void>((resolve) => {
						finishFirstWrite = resolve;
					})
			)
			.mockResolvedValue(undefined);
		const enqueue = createSpaceInboxReadThroughCoordinator(write);

		const first = enqueue({ throughOccurredAtMs: 10 });
		const second = enqueue({ throughOccurredAtMs: 20 });
		const third = enqueue({ throughOccurredAtMs: 30 });

		expect(write).toHaveBeenCalledTimes(1);
		finishFirstWrite?.();
		await first;
		await Promise.all([second, third]);

		expect(write).toHaveBeenCalledTimes(2);
		expect(write).toHaveBeenLastCalledWith({ throughOccurredAtMs: 30 });
	});

	it("keeps main and Thread read positions independent", async () => {
		const write = vi.fn().mockResolvedValue(undefined);
		const enqueue = createSpaceInboxReadThroughCoordinator(write);

		await Promise.all([
			enqueue({ throughOccurredAtMs: 10 }),
			enqueue({ threadRootSignalId: "root", throughOccurredAtMs: 20 }),
		]);

		expect(write).toHaveBeenCalledTimes(2);
		expect(write).toHaveBeenCalledWith({ throughOccurredAtMs: 10 });
		expect(write).toHaveBeenCalledWith({
			threadRootSignalId: "root",
			throughOccurredAtMs: 20,
		});
	});
});
