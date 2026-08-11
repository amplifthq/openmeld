import { describe, expect, it, vi } from "vitest";
import { persistSpaceNameUpdate } from "./space-name-update";

describe("persistSpaceNameUpdate", () => {
	it("keeps a completed rename successful when projection refresh fails", async () => {
		const applyCanonicalName = vi.fn();
		const onRefreshFailure = vi.fn();
		const refreshError = new Error("Space refresh failed");

		await expect(
			persistSpaceNameUpdate({
				applyCanonicalName,
				onRefreshFailure,
				refreshProjections: () => Promise.reject(refreshError),
				updateMeta: () => Promise.resolve({ name: "Launch Room" }),
			})
		).resolves.toBe("Launch Room");

		expect(applyCanonicalName).toHaveBeenCalledWith("Launch Room");
		await vi.waitFor(() => {
			expect(onRefreshFailure).toHaveBeenCalledWith(refreshError);
		});
	});

	it("does not refresh or patch local state when the rename fails", async () => {
		const applyCanonicalName = vi.fn();
		const refreshProjections = vi.fn(async () => undefined);
		const updateError = new Error("Rename failed");

		await expect(
			persistSpaceNameUpdate({
				applyCanonicalName,
				onRefreshFailure: vi.fn(),
				refreshProjections,
				updateMeta: () => Promise.reject(updateError),
			})
		).rejects.toBe(updateError);

		expect(applyCanonicalName).not.toHaveBeenCalled();
		expect(refreshProjections).not.toHaveBeenCalled();
	});

	it("fails closed when the server does not confirm the canonical name", async () => {
		const applyCanonicalName = vi.fn();
		const refreshProjections = vi.fn(async () => undefined);

		await expect(
			persistSpaceNameUpdate({
				applyCanonicalName,
				onRefreshFailure: vi.fn(),
				refreshProjections,
				updateMeta: () => Promise.resolve({}),
			})
		).rejects.toThrow("confirm the updated Space name");

		expect(applyCanonicalName).not.toHaveBeenCalled();
		expect(refreshProjections).not.toHaveBeenCalled();
	});
});
