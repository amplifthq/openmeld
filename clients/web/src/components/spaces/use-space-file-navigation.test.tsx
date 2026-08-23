import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SpaceFileLeaveGuard } from "./space-file-detail";
import { useSpaceFileNavigation } from "./use-space-file-navigation";

describe("useSpaceFileNavigation", () => {
	it("protects a draft before changing Space tabs", () => {
		const discard = vi.fn();
		const { result } = renderHook(() => useSpaceFileNavigation());

		act(() => result.current.changeSpaceView("files"));
		act(() =>
			result.current.setSpaceFileLeaveGuard({
				discard,
				hasUnsavedChanges: true,
				save: vi.fn(async () => true),
			})
		);
		act(() => result.current.changeSpaceView("messages"));

		expect(result.current.spaceView).toBe("files");
		expect(result.current.pendingNavigation).toEqual({
			kind: "view",
			view: "messages",
		});

		act(() => result.current.discardAndContinue());
		expect(discard).toHaveBeenCalledOnce();
		expect(result.current.spaceView).toBe("messages");
	});

	it("opens the exact linked revision only after the current draft is saved", async () => {
		const save = vi.fn<SpaceFileLeaveGuard["save"]>(async () => true);
		const { result } = renderHook(() => useSpaceFileNavigation());

		act(() => result.current.changeSpaceView("files"));
		act(() =>
			result.current.setSpaceFileLeaveGuard({
				discard: vi.fn(),
				hasUnsavedChanges: true,
				save,
			})
		);
		act(() => result.current.openSpaceFile("file-2", 4));

		expect(result.current.spaceFileToOpen).toBeNull();
		await act(async () => {
			expect(await result.current.saveAndContinue()).toBe(true);
		});

		expect(save).toHaveBeenCalledOnce();
		expect(result.current.spaceFileToOpen).toEqual(
			expect.objectContaining({ fileId: "file-2", revision: 4 })
		);
	});
});
