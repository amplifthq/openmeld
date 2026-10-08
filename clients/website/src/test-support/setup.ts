import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

afterEach(cleanup);

// jsdom has no layout engine. Geometry and visibility are verified in the
// browser; link-contract tests need the standard observer lifecycle only.
vi.stubGlobal(
	"IntersectionObserver",
	class implements IntersectionObserver {
		readonly root = null;
		readonly rootMargin = "0px";
		readonly thresholds = [0];
		disconnect = vi.fn();
		observe = vi.fn();
		takeRecords = (): IntersectionObserverEntry[] => [];
		unobserve = vi.fn();
	}
);
vi.stubGlobal(
	"ResizeObserver",
	class implements ResizeObserver {
		disconnect = vi.fn();
		observe = vi.fn();
		unobserve = vi.fn();
	}
);

Object.defineProperty(window, "matchMedia", {
	writable: true,
	value: vi.fn().mockImplementation((query: string) => ({
		matches: false,
		media: query,
		onchange: null,
		addListener: vi.fn(),
		removeListener: vi.fn(),
		addEventListener: vi.fn(),
		removeEventListener: vi.fn(),
		dispatchEvent: vi.fn(),
	})),
});
