export type IdentityImageCrop = {
	positionX: number;
	positionY: number;
	zoom: number;
};

export type IdentityImageCropDraft = {
	height: number;
	previewUrl: string;
	width: number;
};

export const DEFAULT_IDENTITY_IMAGE_CROP: IdentityImageCrop = {
	positionX: 0,
	positionY: 0,
	zoom: 1,
};

export async function createIdentityImageCropDraft(
	file: File
): Promise<IdentityImageCropDraft> {
	const previewUrl = URL.createObjectURL(file);
	try {
		const dimensions = await readImageDimensions(previewUrl);
		return { ...dimensions, previewUrl };
	} catch (error) {
		URL.revokeObjectURL(previewUrl);
		throw error;
	}
}

export function releaseIdentityImageCropDraft(input: {
	previewUrl: string;
}): void {
	URL.revokeObjectURL(input.previewUrl);
}

export function resolveIdentityImageCropPlacement(input: {
	crop: IdentityImageCrop;
	sourceHeight: number;
	sourceWidth: number;
	subject: string;
	viewportSize: number;
}): {
	height: number;
	left: number;
	top: number;
	width: number;
} {
	assertPositiveFinite(input.sourceWidth, "source width", input.subject);
	assertPositiveFinite(input.sourceHeight, "source height", input.subject);
	assertPositiveFinite(input.viewportSize, "viewport size", input.subject);
	const zoom = clamp(input.crop.zoom, 1, 3);
	const positionX = clamp(input.crop.positionX, -1, 1);
	const positionY = clamp(input.crop.positionY, -1, 1);
	const coverScale = Math.max(
		input.viewportSize / input.sourceWidth,
		input.viewportSize / input.sourceHeight
	);
	const width = input.sourceWidth * coverScale * zoom;
	const height = input.sourceHeight * coverScale * zoom;
	const overflowX = Math.max(0, width - input.viewportSize);
	const overflowY = Math.max(0, height - input.viewportSize);
	return {
		height,
		left: resolveCropAxisOffset(overflowX, positionX),
		top: resolveCropAxisOffset(overflowY, positionY),
		width,
	};
}

export async function cropIdentityImage(input: {
	browserErrorMessage: string;
	crop: IdentityImageCrop;
	file: File;
	outputSize: number;
	subject: string;
}): Promise<{
	bytes: Blob;
	mimeType: "image/png" | "image/webp";
}> {
	const decoded = await decodeImage(input.file);
	try {
		const placement = resolveIdentityImageCropPlacement({
			crop: input.crop,
			sourceHeight: decoded.height,
			sourceWidth: decoded.width,
			subject: input.subject,
			viewportSize: input.outputSize,
		});
		const canvas = document.createElement("canvas");
		canvas.width = input.outputSize;
		canvas.height = input.outputSize;
		const context = canvas.getContext("2d");
		if (!context) {
			throw new Error(input.browserErrorMessage);
		}
		context.imageSmoothingEnabled = true;
		context.imageSmoothingQuality = "high";
		context.drawImage(
			decoded.source,
			placement.left,
			placement.top,
			placement.width,
			placement.height
		);
		const webp = await encodeCanvas(
			canvas,
			"image/webp",
			0.9,
			input.browserErrorMessage
		);
		if (webp.type === "image/webp") {
			return { bytes: webp, mimeType: "image/webp" };
		}
		return {
			bytes: await encodeCanvas(
				canvas,
				"image/png",
				undefined,
				input.browserErrorMessage
			),
			mimeType: "image/png",
		};
	} finally {
		decoded.release();
	}
}

async function readImageDimensions(
	source: string
): Promise<{ height: number; width: number }> {
	const image = await loadHtmlImage(source);
	if (!(image.naturalWidth > 0 && image.naturalHeight > 0)) {
		throw new Error("Choose an image that OpenMeld can read.");
	}
	return { height: image.naturalHeight, width: image.naturalWidth };
}

async function decodeImage(file: File): Promise<{
	height: number;
	release: () => void;
	source: CanvasImageSource;
	width: number;
}> {
	if (typeof createImageBitmap === "function") {
		const bitmap = await createImageBitmap(file);
		return {
			height: bitmap.height,
			release: () => bitmap.close(),
			source: bitmap,
			width: bitmap.width,
		};
	}
	const objectUrl = URL.createObjectURL(file);
	try {
		const image = await loadHtmlImage(objectUrl);
		return {
			height: image.naturalHeight,
			release: () => URL.revokeObjectURL(objectUrl),
			source: image,
			width: image.naturalWidth,
		};
	} catch (error) {
		URL.revokeObjectURL(objectUrl);
		throw error;
	}
}

async function loadHtmlImage(source: string): Promise<HTMLImageElement> {
	return await new Promise((resolve, reject) => {
		const image = new Image();
		image.decoding = "async";
		image.onload = () => resolve(image);
		image.onerror = () =>
			reject(new Error("Choose an image that OpenMeld can read."));
		image.src = source;
	});
}

async function encodeCanvas(
	canvas: HTMLCanvasElement,
	type: "image/png" | "image/webp",
	quality: number | undefined,
	browserErrorMessage: string
): Promise<Blob> {
	return await new Promise((resolve, reject) => {
		canvas.toBlob(
			(blob) => {
				if (blob) {
					resolve(blob);
					return;
				}
				reject(new Error(browserErrorMessage));
			},
			type,
			quality
		);
	});
}

function assertPositiveFinite(
	value: number,
	label: string,
	subject: string
): void {
	if (!(Number.isFinite(value) && value > 0)) {
		throw new Error(`${subject} ${label} must be positive.`);
	}
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

function resolveCropAxisOffset(overflow: number, position: number): number {
	return overflow === 0 ? 0 : -overflow / 2 - (position * overflow) / 2;
}
