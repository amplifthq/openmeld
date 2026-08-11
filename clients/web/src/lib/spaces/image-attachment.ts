import {
	SPACE_ATTACHMENT_MAX_DIMENSION,
	SPACE_ATTACHMENT_MAX_FILE_NAME_LENGTH,
	SPACE_ATTACHMENT_MAX_SIZE_BYTES,
} from "@openmeld/schemas";
import type { SpaceAttachmentMimeType } from "@openmeld/schemas/types";

export const SPACE_IMAGE_UNSUPPORTED_ERROR_MESSAGE = "Unsupported image file";
export const SPACE_IMAGE_TOO_LARGE_ERROR_MESSAGE =
	"This image could not be reduced below 5 MB.";

const JPEG_QUALITY_STEPS = [0.9, 0.78, 0.66, 0.54] as const;
const FIRST_REDUCED_LONG_EDGE = 2048;
const MINIMUM_REDUCED_LONG_EDGE = 320;
const RESIZE_FACTOR = 0.8;
const TRANSPARENCY_SAMPLE_LONG_EDGE = 64;
const FILE_NAME_PATH_SEPARATOR_PATTERN = /[\\/]/u;
const FILE_NAME_EXTENSION_PATTERN = /\.[^.]+$/u;

export type PreparedSpaceImageAttachment = {
	blob: Blob;
	fileName: string;
	height: number;
	mimeType: SpaceAttachmentMimeType;
	width: number;
};

/**
 * Converts browser-decodable image bytes into the only two image formats the
 * Space attachment contract accepts. Canvas encoding intentionally removes
 * source metadata such as EXIF before any bytes leave the browser.
 */
export async function prepareSpaceImageAttachment(
	file: File
): Promise<PreparedSpaceImageAttachment> {
	const decoded = await decodeImage(file);
	try {
		const sourceDimensions = constrainDimensions({
			height: decoded.height,
			maxLongEdge: SPACE_ATTACHMENT_MAX_DIMENSION,
			width: decoded.width,
		});
		const hasTransparency = readImageTransparency({
			height: sourceDimensions.height,
			source: decoded.source,
			width: sourceDimensions.width,
		});
		const mimeType: SpaceAttachmentMimeType = hasTransparency
			? "image/png"
			: "image/jpeg";
		const encoded = await encodeWithinAttachmentLimit({
			height: sourceDimensions.height,
			mimeType,
			source: decoded.source,
			width: sourceDimensions.width,
		});

		return {
			...encoded,
			fileName: buildConvertedFileName(file.name, mimeType),
			mimeType,
		};
	} finally {
		decoded.close();
	}
}

type DecodedImage = {
	close: () => void;
	height: number;
	source: CanvasImageSource;
	width: number;
};

async function decodeImage(file: File): Promise<DecodedImage> {
	if (typeof createImageBitmap === "function") {
		try {
			const image = await createImageBitmap(file);
			assertDecodedDimensions(image.width, image.height);
			return {
				close: () => image.close(),
				height: image.height,
				source: image,
				width: image.width,
			};
		} catch {
			// Some browser decoders support a format through HTMLImageElement but
			// not createImageBitmap, so keep the browser-native fallback below.
		}
	}

	let objectUrl: string;
	try {
		objectUrl = URL.createObjectURL(file);
	} catch {
		throw new Error(SPACE_IMAGE_UNSUPPORTED_ERROR_MESSAGE);
	}
	try {
		const image = await new Promise<HTMLImageElement>((resolve, reject) => {
			const element = new Image();
			element.onload = () => resolve(element);
			element.onerror = () =>
				reject(new Error(SPACE_IMAGE_UNSUPPORTED_ERROR_MESSAGE));
			element.src = objectUrl;
		});
		assertDecodedDimensions(image.naturalWidth, image.naturalHeight);
		return {
			close: () => undefined,
			height: image.naturalHeight,
			source: image,
			width: image.naturalWidth,
		};
	} catch {
		throw new Error(SPACE_IMAGE_UNSUPPORTED_ERROR_MESSAGE);
	} finally {
		URL.revokeObjectURL(objectUrl);
	}
}

function assertDecodedDimensions(width: number, height: number): void {
	if (
		!(Number.isFinite(width) && Number.isFinite(height)) ||
		width < 1 ||
		height < 1
	) {
		throw new Error(SPACE_IMAGE_UNSUPPORTED_ERROR_MESSAGE);
	}
}

function readImageTransparency(input: {
	height: number;
	source: CanvasImageSource;
	width: number;
}): boolean {
	const sampleDimensions = constrainDimensions({
		height: input.height,
		maxLongEdge: TRANSPARENCY_SAMPLE_LONG_EDGE,
		width: input.width,
	});
	const { canvas, context } = drawImageToCanvas({
		height: sampleDimensions.height,
		source: input.source,
		width: sampleDimensions.width,
	});
	const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
	for (let index = 3; index < pixels.length; index += 4) {
		if (pixels[index] !== 255) {
			return true;
		}
	}
	return false;
}

async function encodeWithinAttachmentLimit(input: {
	height: number;
	mimeType: SpaceAttachmentMimeType;
	source: CanvasImageSource;
	width: number;
}): Promise<{ blob: Blob; height: number; width: number }> {
	const originalResult = await encodeAtDimensions({
		...input,
		height: input.height,
		width: input.width,
	});
	if (originalResult) {
		return originalResult;
	}

	let dimensions = constrainDimensions({
		height: input.height,
		maxLongEdge: Math.min(
			FIRST_REDUCED_LONG_EDGE,
			Math.max(input.width, input.height)
		),
		width: input.width,
	});
	while (true) {
		const result = await encodeAtDimensions({
			...input,
			height: dimensions.height,
			width: dimensions.width,
		});
		if (result) {
			return result;
		}
		if (
			Math.max(dimensions.width, dimensions.height) <= MINIMUM_REDUCED_LONG_EDGE
		) {
			throw new Error(SPACE_IMAGE_TOO_LARGE_ERROR_MESSAGE);
		}
		dimensions = constrainDimensions({
			height: dimensions.height,
			maxLongEdge: Math.max(
				MINIMUM_REDUCED_LONG_EDGE,
				Math.floor(
					Math.max(dimensions.width, dimensions.height) * RESIZE_FACTOR
				)
			),
			width: dimensions.width,
		});
	}
}

async function encodeAtDimensions(input: {
	height: number;
	mimeType: SpaceAttachmentMimeType;
	source: CanvasImageSource;
	width: number;
}): Promise<{ blob: Blob; height: number; width: number } | null> {
	const { canvas } = drawImageToCanvas(input);
	const qualities =
		input.mimeType === "image/jpeg" ? JPEG_QUALITY_STEPS : [undefined];
	for (const quality of qualities) {
		const blob = await encodeCanvas(canvas, input.mimeType, quality);
		if (blob.size > 0 && blob.size <= SPACE_ATTACHMENT_MAX_SIZE_BYTES) {
			return {
				blob,
				height: canvas.height,
				width: canvas.width,
			};
		}
	}
	return null;
}

function drawImageToCanvas(input: {
	height: number;
	source: CanvasImageSource;
	width: number;
}): { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D } {
	const canvas = document.createElement("canvas");
	canvas.width = input.width;
	canvas.height = input.height;
	const context = canvas.getContext("2d", { willReadFrequently: true });
	if (!context) {
		throw new Error(SPACE_IMAGE_UNSUPPORTED_ERROR_MESSAGE);
	}
	context.clearRect(0, 0, canvas.width, canvas.height);
	context.drawImage(input.source, 0, 0, canvas.width, canvas.height);
	return { canvas, context };
}

async function encodeCanvas(
	canvas: HTMLCanvasElement,
	mimeType: SpaceAttachmentMimeType,
	quality: number | undefined
): Promise<Blob> {
	const blob = await new Promise<Blob | null>((resolve) => {
		canvas.toBlob(resolve, mimeType, quality);
	});
	if (!blob) {
		throw new Error(SPACE_IMAGE_UNSUPPORTED_ERROR_MESSAGE);
	}
	return blob;
}

function constrainDimensions(input: {
	height: number;
	maxLongEdge: number;
	width: number;
}): { height: number; width: number } {
	const longEdge = Math.max(input.width, input.height);
	if (longEdge <= input.maxLongEdge) {
		return {
			height: Math.max(1, Math.round(input.height)),
			width: Math.max(1, Math.round(input.width)),
		};
	}
	const scale = input.maxLongEdge / longEdge;
	return {
		height: Math.max(1, Math.round(input.height * scale)),
		width: Math.max(1, Math.round(input.width * scale)),
	};
}

function buildConvertedFileName(
	originalName: string,
	mimeType: SpaceAttachmentMimeType
): string {
	const leafName =
		originalName
			.trim()
			.split(FILE_NAME_PATH_SEPARATOR_PATTERN)
			.at(-1)
			?.trim() ?? "";
	const withoutExtension =
		leafName.replace(FILE_NAME_EXTENSION_PATTERN, "").trim() || "image";
	const extension = mimeType === "image/png" ? ".png" : ".jpg";
	return `${withoutExtension.slice(
		0,
		SPACE_ATTACHMENT_MAX_FILE_NAME_LENGTH - extension.length
	)}${extension}`;
}
