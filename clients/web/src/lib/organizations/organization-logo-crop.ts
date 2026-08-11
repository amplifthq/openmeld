import { ORGANIZATION_LOGO_OUTPUT_SIZE } from "@openmeld/schemas";
import type { OrganizationLogoMimeType } from "@openmeld/schemas/types";
import {
	createIdentityImageCropDraft,
	cropIdentityImage,
	DEFAULT_IDENTITY_IMAGE_CROP,
	type IdentityImageCrop,
	type IdentityImageCropDraft,
	releaseIdentityImageCropDraft,
	resolveIdentityImageCropPlacement,
} from "#/lib/images/identity-image-crop";

export type OrganizationLogoCrop = IdentityImageCrop;
export type OrganizationLogoCropDraft = IdentityImageCropDraft;

export const DEFAULT_ORGANIZATION_LOGO_CROP: OrganizationLogoCrop = {
	...DEFAULT_IDENTITY_IMAGE_CROP,
};

export async function createOrganizationLogoCropDraft(
	file: File
): Promise<OrganizationLogoCropDraft> {
	return await createIdentityImageCropDraft(file);
}

export function releaseOrganizationLogoCropDraft(input: {
	previewUrl: string;
}): void {
	releaseIdentityImageCropDraft(input);
}

export function resolveOrganizationLogoCropPlacement(input: {
	crop: OrganizationLogoCrop;
	sourceHeight: number;
	sourceWidth: number;
	viewportSize: number;
}): {
	height: number;
	left: number;
	top: number;
	width: number;
} {
	return resolveIdentityImageCropPlacement({
		...input,
		subject: "Organization logo",
	});
}

export async function cropOrganizationLogo(input: {
	crop: OrganizationLogoCrop;
	file: File;
}): Promise<{ bytes: Blob; mimeType: OrganizationLogoMimeType }> {
	return await cropIdentityImage({
		browserErrorMessage:
			"Your browser could not prepare the organization logo.",
		crop: input.crop,
		file: input.file,
		outputSize: ORGANIZATION_LOGO_OUTPUT_SIZE,
		subject: "Organization logo",
	});
}
