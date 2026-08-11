import { afterEach, describe, expect, it, vi } from "vitest";
import {
	prepareSpaceImageAttachment,
	SPACE_IMAGE_UNSUPPORTED_ERROR_MESSAGE,
} from "./image-attachment";

type FakeCanvas = HTMLCanvasElement & {
	toBlob: HTMLCanvasElement["toBlob"];
};

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe("prepareSpaceImageAttachment", () => {
	it("re-encodes an opaque browser-decodable image as JPEG", async () => {
		const harness = installCanvasHarness({
			alpha: 255,
			encodedSizes: [1024],
			height: 800,
			width: 1200,
		});

		const result = await prepareSpaceImageAttachment(
			new File(["source"], "camera.heic", { type: "image/heic" })
		);

		expect(result).toMatchObject({
			fileName: "camera.jpg",
			height: 800,
			mimeType: "image/jpeg",
			width: 1200,
		});
		expect(result.blob).toHaveProperty("size", 1024);
		expect(harness.encodedMimeTypes).toEqual(["image/jpeg"]);
		expect(harness.encodedQualities).toEqual([0.9]);
	});

	it("preserves transparency by emitting PNG bytes", async () => {
		const harness = installCanvasHarness({
			alpha: 128,
			encodedSizes: [2048],
			height: 512,
			width: 512,
		});

		const result = await prepareSpaceImageAttachment(
			new File(["source"], "overlay.webp", { type: "image/webp" })
		);

		expect(result).toMatchObject({
			fileName: "overlay.png",
			height: 512,
			mimeType: "image/png",
			width: 512,
		});
		expect(harness.encodedMimeTypes).toEqual(["image/png"]);
		expect(harness.encodedQualities).toEqual([undefined]);
	});

	it("shrinks an oversized result from a 2048px long edge until it fits", async () => {
		const oversizedBytes = 5 * 1024 * 1024 + 1;
		const harness = installCanvasHarness({
			alpha: 255,
			encodedSizes: [
				oversizedBytes,
				oversizedBytes,
				oversizedBytes,
				oversizedBytes,
				4 * 1024 * 1024,
			],
			height: 3000,
			width: 4000,
		});

		const result = await prepareSpaceImageAttachment(
			new File(["source"], "large.jpg", { type: "image/jpeg" })
		);

		expect(result.blob.size).toBe(4 * 1024 * 1024);
		expect(Math.max(result.width, result.height)).toBe(2048);
		expect(harness.encodedDimensions.at(-1)).toEqual({
			height: 1536,
			width: 2048,
		});
	});

	it("reports an unsupported image when the browser cannot decode it", async () => {
		vi.stubGlobal(
			"createImageBitmap",
			vi.fn().mockRejectedValue(new Error("decoder rejected bytes"))
		);

		await expect(
			prepareSpaceImageAttachment(
				new File(["not-an-image"], "broken.heic", { type: "image/heic" })
			)
		).rejects.toThrow(SPACE_IMAGE_UNSUPPORTED_ERROR_MESSAGE);
	});
});

function installCanvasHarness(input: {
	alpha: number;
	encodedSizes: readonly number[];
	height: number;
	width: number;
}) {
	const encodedDimensions: Array<{ height: number; width: number }> = [];
	const encodedMimeTypes: string[] = [];
	const encodedQualities: Array<number | undefined> = [];
	let encodeIndex = 0;
	const context = {
		clearRect: vi.fn(),
		drawImage: vi.fn(),
		getImageData: vi.fn(() => ({
			data: new Uint8ClampedArray([0, 0, 0, input.alpha]),
		})),
	};
	const originalCreateElement = document.createElement.bind(document);
	vi.spyOn(document, "createElement").mockImplementation(
		(tagName: string, options?: ElementCreationOptions) => {
			if (tagName !== "canvas") {
				return originalCreateElement(tagName, options);
			}

			const canvas = {
				height: 0,
				width: 0,
				getContext: vi.fn(() => context),
				toBlob: vi.fn(
					(callback: BlobCallback, mimeType?: string, quality?: number) => {
						encodedDimensions.push({
							height: canvas.height,
							width: canvas.width,
						});
						encodedMimeTypes.push(mimeType ?? "");
						encodedQualities.push(quality);
						const size =
							input.encodedSizes[
								Math.min(encodeIndex, input.encodedSizes.length - 1)
							] ?? 1;
						encodeIndex += 1;
						callback(
							new Blob([new Uint8Array(size)], {
								type: mimeType,
							})
						);
					}
				),
			} as unknown as FakeCanvas;
			return canvas;
		}
	);
	vi.stubGlobal(
		"createImageBitmap",
		vi.fn().mockResolvedValue({
			close: vi.fn(),
			height: input.height,
			width: input.width,
		})
	);

	return {
		encodedDimensions,
		encodedMimeTypes,
		encodedQualities,
	};
}
