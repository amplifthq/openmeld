import { afterEach, vi } from "vitest";

// Vitest 4's restoreAllMocks() only restores vi.spyOn spies; it no longer
// resets vi.fn() mocks. Reset every mock after each test so call history,
// per-test implementations, and queued once-values never leak into the next
// test. A vi.fn(impl) mock returns to impl.
afterEach(() => {
	vi.resetAllMocks();
});
