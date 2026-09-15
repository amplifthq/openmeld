import type { SpaceApi } from "@openmeld/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useSpaceFileImageSource } from "./use-space-file-image-source";

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

it("fetches remote image bytes only near the viewport and reuses the cached file on return", async () => {
	const callbacks: IntersectionObserverCallback[] = [];
	vi.stubGlobal(
		"IntersectionObserver",
		class {
			constructor(callback: IntersectionObserverCallback) {
				callbacks.push(callback);
			}
			observe = vi.fn();
			disconnect = vi.fn();
		}
	);
	const createObjectURL = vi.fn(() => "blob:local-preview");
	const revokeObjectURL = vi.fn();
	vi.stubGlobal(
		"URL",
		class extends URL {
			static createObjectURL = createObjectURL;
			static revokeObjectURL = revokeObjectURL;
		}
	);
	const downloadFileContent = vi
		.fn<SpaceApi["downloadFileContent"]>()
		.mockResolvedValue({
			bytes: new ArrayBuffer(1),
			mimeType: "image/png",
			revision: 1,
		});
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	function Preview() {
		const image = useSpaceFileImageSource({
			api: { downloadFileContent },
			fileId: "file-photo",
			spaceId: "space-photo",
			revision: 1,
			mimeType: "image/png",
		});
		return (
			<output ref={image.placeholderRef}>
				{image.sourceUrl ?? "Waiting for image"}
			</output>
		);
	}
	const mount = () =>
		render(
			<QueryClientProvider client={client}>
				<Preview />
			</QueryClientProvider>
		);
	const enterViewport = () =>
		act(() => {
			callbacks.at(-1)?.(
				[{ isIntersecting: true } as IntersectionObserverEntry],
				{} as IntersectionObserver
			);
		});
	try {
		const first = mount();
		expect(downloadFileContent).not.toHaveBeenCalled();
		enterViewport();
		await waitFor(() =>
			expect(first.container.textContent).toBe("blob:local-preview")
		);
		expect(downloadFileContent).toHaveBeenCalledOnce();
		first.unmount();
		expect(revokeObjectURL).toHaveBeenCalledWith("blob:local-preview");
		const second = mount();
		expect(second.container.textContent).toBe("Waiting for image");
		expect(createObjectURL).toHaveBeenCalledOnce();
		enterViewport();
		await waitFor(() =>
			expect(second.container.textContent).toBe("blob:local-preview")
		);
		expect(downloadFileContent).toHaveBeenCalledOnce();
		second.unmount();
	} finally {
		client.clear();
	}
});
