"use client";

import {
	ORGANIZATION_LOGO_MAX_SIZE_BYTES,
	organizationLogoMimeTypeSchema,
} from "@openmeld/schemas";
import { Button } from "@openmeld/ui/components/button";
import { SettingsSection } from "@openmeld/ui/components/settings-section";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { IdentityImageCropDialog } from "#/components/images/identity-image-crop-dialog";
import { resolveOrganizationInitials } from "#/components/organizations/organization-identity-mark";
import {
	removeCurrentOrganizationLogo,
	updateCurrentOrganizationLogo,
} from "#/lib/organizations/organization-logo";
import {
	createOrganizationLogoCropDraft,
	cropOrganizationLogo,
	DEFAULT_ORGANIZATION_LOGO_CROP,
	type OrganizationLogoCrop,
	type OrganizationLogoCropDraft,
	releaseOrganizationLogoCropDraft,
} from "#/lib/organizations/organization-logo-crop";
import type { OrganizationSummary } from "#/lib/organizations/organization-types";
import { setOrganizationLogoInScopeCache } from "#/query/organizations/organization-scope";

export function OrganizationLogoSection(input: {
	canManage: boolean | null;
	organization: OrganizationSummary;
	roleError: string | null;
}) {
	const queryClient = useQueryClient();
	const router = useRouter();
	const inputRef = useRef<HTMLInputElement>(null);
	const selectionVersionRef = useRef(0);
	const [crop, setCrop] = useState<OrganizationLogoCrop>(
		DEFAULT_ORGANIZATION_LOGO_CROP
	);
	const [draft, setDraft] = useState<
		(OrganizationLogoCropDraft & { file: File }) | null
	>(null);
	const [selectionError, setSelectionError] = useState<string | null>(null);
	const [savedMessage, setSavedMessage] = useState<string | null>(null);
	const applyOrganizationLogo = async (logo: string | null) => {
		setOrganizationLogoInScopeCache({
			logo,
			organizationId: input.organization.id,
			organizationSlug: input.organization.slug,
			queryClient,
		});
		await router.invalidate({ sync: true });
	};

	useEffect(() => {
		const previewUrl = draft?.previewUrl;
		return () => {
			if (previewUrl) {
				releaseOrganizationLogoCropDraft({ previewUrl });
			}
		};
	}, [draft?.previewUrl]);

	useEffect(
		() => () => {
			selectionVersionRef.current += 1;
		},
		[]
	);

	const uploadMutation = useMutation({
		mutationFn: async () => {
			if (!draft) {
				throw new Error("Choose an organization logo first.");
			}
			const prepared = await cropOrganizationLogo({ crop, file: draft.file });
			return await updateCurrentOrganizationLogo({
				bytes: prepared.bytes,
				mimeType: prepared.mimeType,
				organizationId: input.organization.id,
			});
		},
		onSuccess: async (result) => {
			await applyOrganizationLogo(result.logo);
			setDraft(null);
			setSavedMessage("Organization logo updated.");
		},
	});
	const removeMutation = useMutation({
		mutationFn: async () =>
			await removeCurrentOrganizationLogo({
				organizationId: input.organization.id,
			}),
		onSuccess: async (result) => {
			await applyOrganizationLogo(result.logo);
			setSavedMessage("Organization logo removed.");
		},
	});
	const isMutating = uploadMutation.isPending || removeMutation.isPending;

	const handleFileChange = async (file: File | undefined) => {
		if (!file) {
			return;
		}
		const selectionVersion = selectionVersionRef.current + 1;
		selectionVersionRef.current = selectionVersion;
		setSelectionError(null);
		setSavedMessage(null);
		uploadMutation.reset();
		const mimeType = organizationLogoMimeTypeSchema.safeParse(file.type);
		if (!mimeType.success) {
			setSelectionError("Choose a JPG, PNG, or WebP image.");
			return;
		}
		if (file.size < 1 || file.size > ORGANIZATION_LOGO_MAX_SIZE_BYTES) {
			setSelectionError("Choose an image that is 5 MB or smaller.");
			return;
		}
		try {
			const nextDraft = await createOrganizationLogoCropDraft(file);
			if (selectionVersion !== selectionVersionRef.current) {
				releaseOrganizationLogoCropDraft(nextDraft);
				return;
			}
			setCrop(DEFAULT_ORGANIZATION_LOGO_CROP);
			setDraft({ ...nextDraft, file });
		} catch (error) {
			setSelectionError(
				error instanceof Error
					? error.message
					: "Choose an image that OpenMeld can read."
			);
		}
	};

	return (
		<SettingsSection
			description="Shown in the workspace switcher and anywhere this organization is identified."
			id="organization-logo"
			title="Organization logo"
		>
			<div className="flex flex-wrap items-center gap-4 rounded-md border border-border/70 p-4">
				<OrganizationLogoPreview organization={input.organization} />
				<div className="min-w-0 flex-1">
					<p className="font-medium text-foreground text-sm">
						{input.organization.logo ? "Current logo" : "No logo uploaded"}
					</p>
					<p className="mt-1 text-muted-foreground text-xs">
						JPG, PNG, or WebP. Up to 5 MB.
					</p>
					{input.canManage === true ? (
						<div className="mt-3 flex flex-wrap items-center gap-2">
							<input
								accept="image/jpeg,image/png,image/webp"
								aria-label="Choose organization logo"
								className="sr-only"
								disabled={isMutating}
								onChange={(event) => {
									const file = event.currentTarget.files?.[0];
									event.currentTarget.value = "";
									handleFileChange(file).catch((error) => {
										console.error(
											"Failed to prepare organization logo selection.",
											error
										);
									});
								}}
								ref={inputRef}
								type="file"
							/>
							<Button
								disabled={isMutating}
								onClick={() => inputRef.current?.click()}
								type="button"
								variant="outline"
							>
								{input.organization.logo ? "Replace logo" : "Upload logo"}
							</Button>
							{input.organization.logo ? (
								<Button
									disabled={isMutating}
									onClick={() => {
										setSavedMessage(null);
										removeMutation.mutate();
									}}
									type="button"
									variant="ghost"
								>
									{removeMutation.isPending ? "Removing" : "Remove"}
								</Button>
							) : null}
						</div>
					) : null}
					{input.canManage === false ? (
						<p className="mt-3 text-muted-foreground text-xs">
							Only the organization owner can change the logo.
						</p>
					) : null}
					{input.canManage === null && input.roleError ? (
						<p className="mt-3 text-destructive text-xs" role="alert">
							Logo controls are unavailable: {input.roleError}
						</p>
					) : null}
					{input.canManage === null && !input.roleError ? (
						<p className="mt-3 text-muted-foreground text-xs">
							Checking your organization role.
						</p>
					) : null}
					{selectionError ? (
						<p className="mt-2 text-destructive text-xs" role="alert">
							{selectionError}
						</p>
					) : null}
					{removeMutation.isError ? (
						<p className="mt-2 text-destructive text-xs" role="alert">
							{removeMutation.error.message}
						</p>
					) : null}
					{savedMessage ? (
						<p className="mt-2 text-muted-foreground text-xs">{savedMessage}</p>
					) : null}
				</div>
			</div>
			<IdentityImageCropDialog
				crop={crop}
				description="Position the image inside the square. OpenMeld saves a crisp, consistent logo for every surface."
				draft={draft}
				errorMessage={
					uploadMutation.isError ? uploadMutation.error.message : null
				}
				isSaving={uploadMutation.isPending}
				onCropChange={setCrop}
				onOpenChange={(open) => {
					if (!(open || uploadMutation.isPending)) {
						setDraft(null);
					}
				}}
				onSave={() => uploadMutation.mutate()}
				previewAlt="Organization logo crop preview"
				previewShape="square"
				saveLabel="Save logo"
				subject="Organization logo"
				title="Adjust organization logo"
			/>
		</SettingsSection>
	);
}

function OrganizationLogoPreview(input: { organization: OrganizationSummary }) {
	return (
		<div className="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-sm border border-border bg-muted text-lg text-muted-foreground">
			{input.organization.logo ? (
				<img
					alt={`${input.organization.name} logo`}
					className="size-full object-cover"
					height={80}
					src={input.organization.logo}
					width={80}
				/>
			) : (
				<span aria-hidden="true">
					{resolveOrganizationInitials(input.organization.name)}
				</span>
			)}
		</div>
	);
}
