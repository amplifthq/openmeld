import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { MotionConfig } from "framer-motion";
import { Activity, type ComponentProps, type Ref } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	clearSpaceFileMedia,
	clearSpaceFileMediaResources,
} from "#/query/spaces/space-file-media-resource";
import {
	cacheSpaceComposerMedia,
	seedPublishedSpaceFileMedia,
	spaceFileQueryKeys,
} from "#/query/spaces/space-files";
import { SpaceVideoPreview } from "./space-video-preview";

const playerRender = vi.hoisted(() => vi.fn());
// Vitest's server module graph has no browser asset URL. Exercise the same
// module asynchronously; emitted-code tests verify the native URL boundary.
vi.mock("./load-space-video-playback", () => ({
	loadSpaceVideoPlayback: () =>
		import("./space-video-playback").then(
			(module) => module.SpaceVideoPlayback
		),
}));
// The native decoder/third-party controls are the boundary; the real lazy
// loader, lifecycle, Morphing Dialog, source ownership and cache run here.
vi.mock("@openmeld/ui/components/video-player", () => ({
	VideoPlayer: (input: {
		title: string;
		videoRef: Ref<HTMLVideoElement>;
		videoProps: ComponentProps<"video">;
	}) => {
		playerRender();
		return (
			<video
				{...input.videoProps}
				aria-label={input.title}
				ref={input.videoRef}
			/>
		);
	},
}));

const clients: QueryClient[] = [];
const target = {
	spaceId: "space-1",
	fileId: "video-1",
	revision: 2,
	organizationSlug: "acme",
};
beforeEach(() => {
	playerRender.mockClear();
	vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
	vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(
		() => undefined
	);
	vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function (
		this: HTMLMediaElement
	) {
		Object.defineProperty(this, "paused", { configurable: true, value: false });
		this.dispatchEvent(new Event("play"));
		return Promise.resolve();
	});
	vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(function (
		this: HTMLMediaElement
	) {
		Object.defineProperty(this, "paused", { configurable: true, value: true });
		this.dispatchEvent(new Event("pause"));
	});
	vi.stubGlobal(
		"URL",
		class extends URL {
			static createObjectURL = vi.fn(() => "blob:original-video");
			static revokeObjectURL = vi.fn();
		}
	);
});
afterEach(() => {
	cleanup();
	for (const client of clients.splice(0)) {
		clearSpaceFileMediaResources(client);
		client.clear();
	}
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

function createClient() {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	clients.push(client);
	return client;
}
function preview(
	props: Partial<ComponentProps<typeof SpaceVideoPreview>> = {}
) {
	return (
		<MotionConfig reducedMotion="always">
			<SpaceVideoPreview fileName="demo.mp4" target={target} {...props} />
		</MotionConfig>
	);
}
async function start(name = "demo.mp4") {
	fireEvent.click(screen.getByRole("button", { name: `Play ${name}` }));
	const video = await screen.findByLabelText<HTMLVideoElement>(name, {
		selector: "video",
	});
	Object.defineProperty(video, "duration", { configurable: true, value: 120 });
	fireEvent.loadedMetadata(video);
	return video;
}

describe("Space video preview", () => {
	it("keeps a compact poster in its rail, plays only in the dialog, and revokes both", async () => {
		const client = createClient();
		const view = render(
			<QueryClientProvider client={client}>
				{preview({ compact: true })}
			</QueryClientProvider>
		);
		const poster = view.container.querySelector<HTMLVideoElement>(
			"video[aria-hidden='true']"
		);
		expect(poster).not.toBeNull();
		fireEvent.loadedData(poster as HTMLVideoElement);
		await act(async () => {
			await Promise.resolve();
		});
		expect(view.container.querySelector("video:not([aria-hidden])")).toBeNull();
		const video = await start();
		expect(screen.getByRole("dialog").contains(video)).toBe(true);
		expect(view.container.querySelector("video")).toBeNull();
		act(() => clearSpaceFileMedia(client, "space-1", "video-1"));
		expect(video.getAttribute("src")).toBeNull();
		expect(view.container.querySelector("video")).toBeNull();
		expect(
			screen.getByRole("button", { name: "Play demo.mp4" })
		).toHaveProperty("disabled", true);
	});

	it("revokes a compact native poster before its playback module has loaded", () => {
		const client = createClient();
		const view = render(
			<QueryClientProvider client={client}>
				{preview({ compact: true })}
			</QueryClientProvider>
		);
		const poster = view.container.querySelector("video");
		expect(poster?.getAttribute("src")).toContain("revision=2");
		act(() => clearSpaceFileMedia(client, "space-1", "video-1"));
		expect(poster?.getAttribute("src")).toBeNull();
		expect(view.container.querySelector("video")).toBeNull();
		expect(playerRender).not.toHaveBeenCalled();
	});

	it("pauses and releases the decoder when a cached Space hides, without autoplay on return", async () => {
		const tree = (mode: "visible" | "hidden") => (
			<Activity mode={mode}>{preview()}</Activity>
		);
		const view = render(tree("visible"));
		const video = await start();
		video.currentTime = 23;
		view.rerender(tree("hidden"));
		expect(video.paused).toBe(true);
		expect(video.getAttribute("src")).toBeNull();
		view.rerender(tree("visible"));
		const returned = await screen.findByLabelText<HTMLVideoElement>(
			"demo.mp4",
			{ selector: "video" }
		);
		fireEvent.loadedMetadata(returned);
		expect(returned.currentTime).toBe(23);
		expect(returned.paused).toBe(true);
		view.unmount();
		expect(returned.getAttribute("src")).toBeNull();
	});

	it("shows lazy first frames and starts a prepared player on one click", async () => {
		const client = createClient();
		render(
			<QueryClientProvider client={client}>
				{Array.from({ length: 24 }, (_, index) => `video-${index}`).map(
					(fileId) => (
						<SpaceVideoPreview
							fileName={`${fileId}.mp4`}
							key={fileId}
							target={{ ...target, fileId }}
						/>
					)
				)}
			</QueryClientProvider>
		);
		const posters = document.querySelectorAll("video[aria-hidden='true']");
		expect(posters).toHaveLength(24);
		expect(posters[0]?.getAttribute("preload")).toBe("metadata");
		expect(posters[0]?.getAttribute("loading")).toBe("lazy");
		expect(posters[0]?.getAttribute("src")).toContain("revision=2");
		expect(playerRender).not.toHaveBeenCalled();
		expect(client.getQueryCache().getAll()).toHaveLength(0);
		fireEvent.loadedData(posters[0] as HTMLVideoElement);
		const first = await screen.findByLabelText<HTMLVideoElement>(
			"video-0.mp4",
			{ selector: "video" }
		);
		expect(first.paused).toBe(true);
		fireEvent.click(screen.getByRole("button", { name: "Play video-0.mp4" }));
		expect(first.paused).toBe(false);
	});

	it("streams the pinned revision and transfers progress to one expanded player", async () => {
		render(preview());
		const inline = await start();
		expect(inline.getAttribute("src")).toBe(
			"/v1/spaces/space-1/files/video-1/content?revision=2&__openmeld_organization_slug=acme"
		);
		inline.currentTime = 41;
		inline.playbackRate = 1.5;
		inline.muted = true;
		fireEvent.click(screen.getByRole("button", { name: "Expand demo.mp4" }));
		await waitFor(() =>
			expect(
				document.querySelectorAll("video:not([aria-hidden])")
			).toHaveLength(1)
		);
		const expanded = screen.getByLabelText<HTMLVideoElement>("demo.mp4", {
			selector: "video",
		});
		expect(expanded).not.toBe(inline);
		fireEvent.loadedMetadata(expanded);
		expect(expanded.currentTime).toBe(41);
		expect(expanded.playbackRate).toBe(1.5);
		expect(expanded.muted).toBe(true);
		expect(expanded.paused).toBe(false);
		expect(inline.getAttribute("src")).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "Close video" }));
		await waitFor(() =>
			expect(
				document.querySelectorAll("video:not([aria-hidden])")
			).toHaveLength(1)
		);
		expect(expanded.paused).toBe(true);
		expect(expanded.getAttribute("src")).toBeNull();
	});

	it("pauses the previous video and stops playback when the page hides", async () => {
		render(
			<>
				{preview()}
				<SpaceVideoPreview
					fileName="second.mp4"
					target={{ ...target, fileId: "video-2" }}
				/>
			</>
		);
		const first = await start();
		const second = await start("second.mp4");
		expect(first.paused).toBe(true);
		expect(second.paused).toBe(false);
		vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
		fireEvent(document, new Event("visibilitychange"));
		expect(second.paused).toBe(true);
	});

	it("keeps the local File and decoder when upload publication supplies canonical identity", async () => {
		const client = createClient();
		const file = new File(["original"], "demo.mp4", { type: "video/mp4" });
		const url = cacheSpaceComposerMedia({
			queryClient: client,
			spaceId: "space-1",
			localId: "local-1",
			mimeType: file.type,
			bytes: file,
		});
		const view = render(
			<QueryClientProvider client={client}>
				{preview({
					target: { ...target, fileId: "local-1", revision: 1 },
					localPreviewUrl: url,
					isLocal: true,
				})}
			</QueryClientProvider>
		);
		const video = await start();
		video.currentTime = 37;
		const loads = vi.mocked(HTMLMediaElement.prototype.load).mock.calls.length;
		act(() =>
			seedPublishedSpaceFileMedia({
				queryClient: client,
				spaceId: "space-1",
				fileId: "video-1",
				revision: 2,
				mimeType: file.type,
				sizeBytes: file.size,
				localId: "local-1",
				previewUrl: url,
				bytes: file,
			})
		);
		view.rerender(
			<QueryClientProvider client={client}>{preview()}</QueryClientProvider>
		);
		expect(screen.getByLabelText("demo.mp4", { selector: "video" })).toBe(
			video
		);
		expect(video.getAttribute("src")).toBe(url);
		expect(video.currentTime).toBe(37);
		expect(vi.mocked(HTMLMediaElement.prototype.load).mock.calls.length).toBe(
			loads
		);
		expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
		expect(
			client.getQueryData<{ bytes: File }>(
				spaceFileQueryKeys.content("space-1", "video-1", 2)
			)?.bytes
		).toBe(file);
	});

	it("immediately removes a remote decoder on authoritative file revocation", async () => {
		const client = createClient();
		render(
			<QueryClientProvider client={client}>{preview()}</QueryClientProvider>
		);
		const video = await start();
		act(() => clearSpaceFileMedia(client, "space-1", "different-file"));
		expect(video.getAttribute("src")).not.toBeNull();
		act(() => clearSpaceFileMedia(client, "space-1", "video-1"));
		expect(video.getAttribute("src")).toBeNull();
		expect(video.paused).toBe(true);
		expect(screen.getByRole("alert").textContent).toContain(
			"no longer accessible"
		);
		expect(document.querySelectorAll("video:not([aria-hidden])")).toHaveLength(
			0
		);
	});

	it("keeps browser autoplay refusal honestly paused and exposes unsupported-format recovery", async () => {
		vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValue(
			new DOMException("Gesture required", "NotAllowedError")
		);
		render(preview());
		const video = await start();
		await act(async () => {
			await Promise.resolve();
		});
		expect(video.paused).toBe(true);
		expect(screen.queryByRole("alert")).toBeNull();
		fireEvent.error(video);
		expect(screen.getByRole("alert").textContent).toContain(
			"format may not be supported"
		);
		expect(
			screen
				.getByRole("link", { name: "Download original" })
				.getAttribute("href")
		).toContain("revision=2");
	});
});
