import {
	ACCOUNT_AVATAR_MAX_SIZE_BYTES,
	ACCOUNT_AVATAR_OUTPUT_SIZE,
	accountAvatarMimeTypeSchema,
} from "@openmeld/schemas";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@openmeld/ui/components/alert-dialog";
import { AvatarAction } from "@openmeld/ui/components/avatar";
import { Badge } from "@openmeld/ui/components/badge";
import { buttonVariants } from "@openmeld/ui/components/button";
import {
	SettingsAccountActionCard,
	SettingsAccountProfileCard,
} from "@openmeld/ui/components/settings-account";
import {
	CalendarBlankIcon,
	CameraIcon,
	ShieldCheckIcon,
	ShieldSlashIcon,
	SignOutIcon,
	XIcon,
} from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { IdentityImageCropDialog } from "#/components/images/identity-image-crop-dialog";
import { DitherProfileAvatar } from "#/components/profiles/dither-profile-avatar";
import {
	useAccountAvatar,
	useAccountSession,
	useRemoveAccountAvatar,
	useUpdateAccountAvatar,
} from "#/hooks/account.hooks";
import {
	createIdentityImageCropDraft,
	cropIdentityImage,
	DEFAULT_IDENTITY_IMAGE_CROP,
	type IdentityImageCrop,
	type IdentityImageCropDraft,
	releaseIdentityImageCropDraft,
} from "#/lib/images/identity-image-crop";
import { useDefaultHumanProfile } from "#/lib/profiles/use-default-human-profile";
import { UserAvatarCardSkeleton } from "./account-skeletons";

const NAME_SEPARATOR_PATTERN = /\s+/;

function buildInitials(name?: string, email?: string): string {
	if (name?.trim()) {
		return name
			.trim()
			.split(NAME_SEPARATOR_PATTERN)
			.slice(0, 2)
			.map((segment) => segment.charAt(0).toUpperCase())
			.join("");
	}

	return email?.charAt(0).toUpperCase() ?? "?";
}

function normalizeUserAvatarImage(value: unknown): string | undefined {
	if (typeof value !== "string") {
		return undefined;
	}

	const normalized = value.trim();
	return normalized.length > 0 ? normalized : undefined;
}

function formatJoinDate(input: unknown): string {
	if (!input) {
		return "Join date unknown";
	}

	const date = new Date(String(input));
	if (Number.isNaN(date.getTime())) {
		return "Join date unknown";
	}

	return date.toLocaleDateString("en-US", {
		year: "numeric",
		month: "long",
		day: "numeric",
	});
}

export function UserAvatarCard() {
	const { data: currentSession, isPending } = useAccountSession();
	const { data: currentAccountAvatar } = useAccountAvatar();
	const { defaultHumanProfile } = useDefaultHumanProfile();

	if (isPending) {
		return <UserAvatarCardSkeleton />;
	}

	const user = currentSession?.user;
	if (!user) {
		return (
			<SettingsAccountActionCard
				description="No user data available."
				title="User Profile"
			/>
		);
	}
	const initials = buildInitials(user.name, user.email);
	const avatarImage = normalizeUserAvatarImage(currentAccountAvatar?.avatar);
	const joinDate = formatJoinDate(user.createdAt);
	const displayName = user.name ?? "No display name";

	return (
		<SettingsAccountProfileCard
			avatar={
				defaultHumanProfile ? (
					<AccountAvatarEditor
						currentAvatar={avatarImage}
						profileId={defaultHumanProfile.openMeldProfileId}
						profileName={
							user.name?.trim() ||
							user.email?.trim() ||
							defaultHumanProfile.profileName
						}
					/>
				) : undefined
			}
			avatarAlt={user.name ?? "User"}
			avatarSrc={avatarImage}
			badge={
				<Badge variant="outline">
					{user.emailVerified ? (
						<ShieldCheckIcon className="size-3" />
					) : (
						<ShieldSlashIcon className="size-3" />
					)}
					{user.emailVerified ? "Verified" : "Unverified"}
				</Badge>
			}
			displayName={displayName}
			email={user.email ?? "No email"}
			footerAction={
				<Link
					className={buttonVariants({ size: "sm", variant: "destructive" })}
					to="/logout"
				>
					<SignOutIcon aria-hidden="true" data-icon="inline-start" />
					Log out
				</Link>
			}
			footerMeta={
				<span className="flex items-center gap-1">
					<CalendarBlankIcon className="size-3" />
					Joined {joinDate}
				</span>
			}
			initials={initials}
		/>
	);
}

function AccountAvatarEditor(input: {
	currentAvatar?: string;
	profileId: string;
	profileName: string;
}) {
	const inputRef = useRef<HTMLInputElement>(null);
	const saveInFlightRef = useRef(false);
	const selectionVersionRef = useRef(0);
	const updateAvatar = useUpdateAccountAvatar({
		defaultHumanProfileId: input.profileId,
	});
	const removeAvatar = useRemoveAccountAvatar({
		defaultHumanProfileId: input.profileId,
	});
	const [crop, setCrop] = useState<IdentityImageCrop>(
		DEFAULT_IDENTITY_IMAGE_CROP
	);
	const [draft, setDraft] = useState<
		(IdentityImageCropDraft & { file: File }) | null
	>(null);
	const [saveError, setSaveError] = useState<string | null>(null);
	const [actionError, setActionError] = useState<string | null>(null);
	const [isPreparingAvatar, setIsPreparingAvatar] = useState(false);
	const [removeDialogOpen, setRemoveDialogOpen] = useState(false);

	useEffect(() => {
		const previewUrl = draft?.previewUrl;
		return () => {
			if (previewUrl) {
				releaseIdentityImageCropDraft({ previewUrl });
			}
		};
	}, [draft?.previewUrl]);

	useEffect(
		() => () => {
			selectionVersionRef.current += 1;
		},
		[]
	);

	const handleFileChange = async (file: File | undefined) => {
		if (!file) {
			return;
		}
		const selectionVersion = selectionVersionRef.current + 1;
		selectionVersionRef.current = selectionVersion;
		setActionError(null);
		setSaveError(null);
		updateAvatar.reset();
		const mimeType = accountAvatarMimeTypeSchema.safeParse(file.type);
		if (!mimeType.success) {
			setActionError("Choose a JPG, PNG, or WebP image.");
			return;
		}
		if (file.size < 1 || file.size > ACCOUNT_AVATAR_MAX_SIZE_BYTES) {
			setActionError("Choose an image that is 5 MB or smaller.");
			return;
		}
		try {
			const nextDraft = await createIdentityImageCropDraft(file);
			if (selectionVersion !== selectionVersionRef.current) {
				releaseIdentityImageCropDraft(nextDraft);
				return;
			}
			setCrop(DEFAULT_IDENTITY_IMAGE_CROP);
			setDraft({ ...nextDraft, file });
		} catch (error) {
			setActionError(
				error instanceof Error
					? error.message
					: "Choose an image that OpenMeld can read."
			);
		}
	};

	const saveAvatar = async () => {
		if (!draft || saveInFlightRef.current) {
			return;
		}
		saveInFlightRef.current = true;
		setIsPreparingAvatar(true);
		setSaveError(null);
		try {
			const prepared = await cropIdentityImage({
				browserErrorMessage:
					"Your browser could not prepare the profile photo.",
				crop,
				file: draft.file,
				outputSize: ACCOUNT_AVATAR_OUTPUT_SIZE,
				subject: "Profile photo",
			});
			await updateAvatar.mutateAsync(prepared);
			setDraft(null);
			toast.success("Profile photo updated.");
		} catch (error) {
			setSaveError(
				error instanceof Error
					? error.message
					: "OpenMeld could not save this profile photo."
			);
		} finally {
			saveInFlightRef.current = false;
			setIsPreparingAvatar(false);
		}
	};

	const removeCurrentAvatar = async () => {
		setActionError(null);
		try {
			await removeAvatar.mutateAsync();
			setRemoveDialogOpen(false);
			toast.success("Profile photo removed.");
		} catch (error) {
			console.error("Failed to remove profile photo.", error);
			setActionError(
				error instanceof Error
					? error.message
					: "OpenMeld could not remove this profile photo."
			);
		}
	};

	const isSaving = isPreparingAvatar || updateAvatar.isPending;
	const isMutating = isSaving || removeAvatar.isPending;
	const changeLabel = input.currentAvatar ? "Change photo" : "Add photo";
	return (
		<div className="grid shrink-0 gap-2" data-testid="account-avatar-editor">
			<div className="group/account-avatar relative size-16 shrink-0">
				<DitherProfileAvatar
					avatarImageUrl={input.currentAvatar}
					className="block"
					data-testid="account-human-profile-avatar"
					key={input.currentAvatar ? "profile-photo" : "generated-avatar"}
					profileId={input.profileId}
					profileKind="human"
					profileName={input.profileName}
					size={64}
				/>
				<input
					accept="image/jpeg,image/png,image/webp"
					aria-label="Choose profile photo"
					className="sr-only"
					disabled={isMutating}
					onChange={(event) => {
						const file = event.currentTarget.files?.[0];
						event.currentTarget.value = "";
						handleFileChange(file).catch((error) => {
							console.error(
								"Failed to prepare profile photo selection.",
								error
							);
							setActionError("OpenMeld could not prepare this profile photo.");
						});
					}}
					ref={inputRef}
					type="file"
				/>
				<button
					aria-label={changeLabel}
					className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-0.5 rounded-full bg-black/65 text-white opacity-0 outline-none transition-opacity focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-wait group-focus-within/account-avatar:opacity-100 group-hover/account-avatar:opacity-100 [@media(hover:none)]:bg-transparent [@media(hover:none)]:opacity-100"
					disabled={isMutating}
					onClick={() => inputRef.current?.click()}
					type="button"
				>
					<CameraIcon
						aria-hidden="true"
						className="size-4 [@media(hover:none)]:absolute [@media(hover:none)]:right-0 [@media(hover:none)]:bottom-0 [@media(hover:none)]:box-content [@media(hover:none)]:size-3.5 [@media(hover:none)]:rounded-full [@media(hover:none)]:bg-black/75 [@media(hover:none)]:p-1.5 [@media(hover:none)]:shadow-sm"
						weight="bold"
					/>
					<span className="font-medium text-[9px] leading-none [@media(hover:none)]:sr-only">
						{changeLabel}
					</span>
				</button>
				{input.currentAvatar ? (
					<AvatarAction
						aria-label="Remove photo"
						className="z-50 text-background opacity-0 transition-opacity focus-visible:opacity-100 group-focus-within/account-avatar:opacity-100 group-hover/account-avatar:opacity-100 [@media(hover:none)]:opacity-100"
						disabled={isMutating}
						onClick={() => setRemoveDialogOpen(true)}
						title="Remove photo"
					>
						<XIcon aria-hidden="true" weight="bold" />
					</AvatarAction>
				) : null}
			</div>
			{actionError ? (
				<p className="w-52 text-destructive text-xs leading-4" role="alert">
					{actionError}
				</p>
			) : null}
			<IdentityImageCropDialog
				crop={crop}
				description="Position the image inside the circle. OpenMeld uses this photo wherever your Human Profile appears."
				draft={draft}
				errorMessage={
					saveError ??
					(updateAvatar.isError ? updateAvatar.error.message : null)
				}
				isSaving={isSaving}
				onCropChange={setCrop}
				onOpenChange={(open) => {
					if (!(open || isSaving)) {
						setDraft(null);
					}
				}}
				onSave={saveAvatar}
				previewAlt="Profile photo crop preview"
				previewShape="circle"
				saveLabel="Save photo"
				subject="Profile photo"
				title="Adjust profile photo"
			/>
			<AlertDialog
				onOpenChange={(open) => {
					if (!removeAvatar.isPending) {
						setRemoveDialogOpen(open);
					}
				}}
				open={removeDialogOpen}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Remove profile photo?</AlertDialogTitle>
						<AlertDialogDescription>
							This photo will be deleted. Your generated profile avatar will
							appear instead.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={removeAvatar.isPending}>
							Cancel
						</AlertDialogCancel>
						<AlertDialogAction
							disabled={removeAvatar.isPending}
							onClick={() => removeCurrentAvatar()}
							type="button"
							variant="destructive"
						>
							{removeAvatar.isPending ? "Removing" : "Remove photo"}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}
