"use client";

import {
	CENTER_AGENT_BOT_AVATAR_TYPES,
	HOSTED_CENTER_AGENT_CONTROLLER_REF,
} from "@openmeld/schemas";
import type {
	AuthProfileView,
	CenterAgentUpdateProfileBody,
} from "@openmeld/schemas/types";
import { BotAvatar } from "@openmeld/ui/components/bot-avatar";
import { Button } from "@openmeld/ui/components/button";
import {
	Dialog,
	DialogDescription,
	DialogTitle,
	DialogTrigger,
} from "@openmeld/ui/components/dialog";
import { FluidAvatar } from "@openmeld/ui/components/fluid-avatar";
import {
	ToggleGroup,
	ToggleGroupItem,
} from "@openmeld/ui/components/toggle-group";
import { DialogContent } from "@openmeld/ui/fluid/dialog";
import { FluidHoverHighlight } from "@openmeld/ui/fluid/fluid-hover-highlight";
import { useFluidHover } from "@openmeld/ui/hooks/use-fluid-hover";
import { useMediaQuery } from "@openmeld/ui/hooks/use-media-query";
import {
	CaretLeftIcon,
	CaretRightIcon,
	CheckIcon,
	PencilSimpleIcon,
	UploadSimpleIcon,
} from "@phosphor-icons/react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { IdentityImageCropDialog } from "#/components/images/identity-image-crop-dialog";
import { useBotAvatarPreference } from "#/lib/appearance/bot-avatar-preference";
import {
	createIdentityImageCropDraft,
	cropIdentityImage,
	DEFAULT_IDENTITY_IMAGE_CROP,
	type IdentityImageCropDraft,
	releaseIdentityImageCropDraft,
} from "#/lib/images/identity-image-crop";
import { useAgentAvatarProfile } from "#/query/profiles/agent-avatar-context";
import { AGENT_AVATAR_COLORS } from "./agent-avatar-colors";
import {
	type AgentAvatarStyle,
	RemoteAgentAvatar,
} from "./remote-agent-avatar";

type Selection = NonNullable<CenterAgentUpdateProfileBody["avatar"]>;
type Draft = Selection | { kind: "saved" };
type Palette = "original" | "balanced" | "soft";
const palettes: Palette[] = ["original", "balanced", "soft"];
const label = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);
const same = (a: Draft, b: Draft) => JSON.stringify(a) === JSON.stringify(b);

export function CenterAgentAvatarEditor(input: {
	profileId: string;
	profileName: string;
	avatarStyle?: AgentAvatarStyle | null;
	avatarOptions?: AuthProfileView["avatarOptions"];
	canEdit: boolean;
	saving: boolean;
	onSave: (avatar: Selection) => Promise<void>;
}) {
	const profile = useAgentAvatarProfile(input.profileId);
	const style = profile?.avatarStyle ?? input.avatarStyle;
	const options = profile ? profile.avatarOptions : input.avatarOptions;
	const current = currentDraft(style, options);
	const [draft, setDraft] = useState<Draft>(current);
	const [open, setOpen] = useState(false);
	const [page, setPage] = useState(0);
	const [error, setError] = useState<string | null>(null);
	const [cropDraft, setCropDraft] = useState<
		(IdentityImageCropDraft & { file: File }) | null
	>(null);
	const [crop, setCrop] = useState(DEFAULT_IDENTITY_IMAGE_CROP);
	const [cropping, setCropping] = useState(false);
	const fileInput = useRef<HTMLInputElement>(null);
	const request = useRef(0);
	const cropRef = useRef(cropDraft);
	cropRef.current = cropDraft;
	useEffect(
		() => () => {
			request.current++;
			if (cropRef.current) {
				releaseIdentityImageCropDraft(cropRef.current);
			}
		},
		[]
	);
	const small = useMediaQuery("(max-width: 640px)");
	const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
	const { motionEnabled, shading } = useBotAvatarPreference();
	const palette =
		draft.kind === "bot" ? draft.palette : (options?.palette ?? "original");
	const closeCrop = () => {
		if (cropDraft) {
			releaseIdentityImageCropDraft(cropDraft);
		}
		setCropDraft(null);
		setError(null);
	};
	const setOpenState = (next: boolean) => {
		if (input.saving || cropping) {
			return;
		}
		request.current++;
		if (next) {
			setDraft(current);
			setError(null);
			setPage(
				current.kind === "bot"
					? Math.floor(CENTER_AGENT_BOT_AVATAR_TYPES.indexOf(current.type) / 12)
					: 0
			);
		}
		setOpen(next);
	};
	const savedAvatar = (size: number) => (
		<RemoteAgentAvatar
			agentControllerRef={HOSTED_CENTER_AGENT_CONTROLLER_REF}
			avatarOptions={options}
			avatarStyle={style}
			profileId={input.profileId}
			profileName={input.profileName}
			shape="circle"
			size={size}
		/>
	);
	async function chooseImage(file?: File) {
		if (!file) {
			return;
		}
		const revision = ++request.current;
		setError(null);
		if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
			setError("Choose a JPG, PNG, or WebP image.");
			return;
		}
		if (file.size > 5 * 1024 * 1024) {
			setError("Choose an image smaller than 5 MB.");
			return;
		}
		try {
			const image = await createIdentityImageCropDraft(file);
			if (revision !== request.current) {
				releaseIdentityImageCropDraft(image);
				return;
			}
			if (image.width * image.height > 40_000_000) {
				releaseIdentityImageCropDraft(image);
				setError("Choose a smaller image.");
				return;
			}
			setCrop(DEFAULT_IDENTITY_IMAGE_CROP);
			setCropDraft({ ...image, file });
		} catch {
			setError("This image could not be opened. Choose another image.");
		}
	}
	async function applyCrop() {
		if (!cropDraft) {
			return;
		}
		setCropping(true);
		try {
			const image = await cropIdentityImage({
				file: cropDraft.file,
				crop,
				outputSize: 256,
				subject: "Avatar",
				browserErrorMessage: "This image could not be cropped.",
			});
			const dataUrl = await new Promise<string>((resolve, reject) => {
				const reader = new FileReader();
				reader.onload = () => resolve(String(reader.result));
				reader.onerror = reject;
				reader.readAsDataURL(image.bytes);
			});
			setDraft({ kind: "image", dataUrl });
			closeCrop();
		} catch {
			setError("This image could not be cropped. Try another image.");
		} finally {
			setCropping(false);
		}
	}
	return (
		<>
			<Dialog onOpenChange={setOpenState} open={open}>
				{input.canEdit ? (
					<DialogTrigger
						render={
							<button
								aria-label="Edit avatar"
								className="relative shrink-0 rounded-full focus-visible:outline-2 focus-visible:outline-ring"
								disabled={input.saving}
								type="button"
							/>
						}
					>
						{savedAvatar(64)}
						<span className="absolute -right-1 -bottom-1 grid size-6 place-items-center rounded-full border border-border bg-background shadow-sm">
							<PencilSimpleIcon className="size-3.5" />
						</span>
					</DialogTrigger>
				) : (
					savedAvatar(64)
				)}
				<DialogContent
					className="gap-0 overflow-y-auto p-0 sm:max-w-[800px]"
					size="xl"
				>
					<div className="grid sm:grid-cols-[1.35fr_1fr]">
						<div className="p-5 sm:p-7">
							<DialogTitle className="mb-7 font-semibold text-xl">
								Choose an avatar
							</DialogTitle>
							<DialogDescription className="sr-only">
								Choose a bot, color, or custom image. Preview your avatar before
								saving.
							</DialogDescription>
							<section aria-label="Bots">
								<div className="mb-3 flex items-center justify-between">
									<h2 className="font-medium text-muted-foreground text-xs">
										Bots
									</h2>
									<div className="flex gap-1">
										<Button
											aria-label="Previous bots"
											disabled={page === 0 || input.saving}
											onClick={() => setPage(page - 1)}
											size="icon-xs"
											variant="ghost"
										>
											<CaretLeftIcon />
										</Button>
										<Button
											aria-label="More bots"
											disabled={
												(page + 1) * 12 >=
													CENTER_AGENT_BOT_AVATAR_TYPES.length || input.saving
											}
											onClick={() => setPage(page + 1)}
											size="icon-xs"
											variant="ghost"
										>
											<CaretRightIcon />
										</Button>
									</div>
								</div>
								<div className="min-h-32">
									<AvatarChoices
										disabled={input.saving}
										items={CENTER_AGENT_BOT_AVATAR_TYPES.slice(
											page * 12,
											(page + 1) * 12
										).map((type) => ({
											value: type,
											label: label(type),
											content: (
												<BotAvatar
													motionEnabled={false}
													palette={palette}
													preview
													shading={shading}
													size={48}
													type={type}
												/>
											),
											onSelect: () => setDraft({ kind: "bot", type, palette }),
										}))}
										key={page}
										label="Bots"
										selected={draft.kind === "bot" ? draft.type : ""}
									/>
								</div>
							</section>
							<section aria-label="Colors" className="mt-6">
								<h2 className="mb-3 font-medium text-muted-foreground text-xs">
									Colors
								</h2>
								<AvatarChoices
									disabled={input.saving}
									items={(
										Object.keys(
											AGENT_AVATAR_COLORS
										) as (keyof typeof AGENT_AVATAR_COLORS)[]
									).map((color) => ({
										value: color,
										label: AGENT_AVATAR_COLORS[color].name,
										content: (
											<FluidAvatar
												seed={AGENT_AVATAR_COLORS[color].seed}
												size={36}
											/>
										),
										onSelect: () => setDraft({ kind: "color", color }),
									}))}
									label="Colors"
									selected={draft.kind === "color" ? draft.color : ""}
								/>
							</section>
							<section aria-label="Custom" className="mt-6">
								<h2 className="mb-3 font-medium text-muted-foreground text-xs">
									Custom
								</h2>
								<div className="flex items-center gap-3">
									<Button
										className="shrink-0"
										disabled={input.saving}
										onClick={() => fileInput.current?.click()}
										size="sm"
										variant="secondary"
									>
										<UploadSimpleIcon className="size-3.5" />
										Upload image
									</Button>
									<p className="text-muted-foreground text-xs">
										JPG, PNG, or WebP. Up to 5 MB.
									</p>
								</div>
								<input
									accept="image/jpeg,image/png,image/webp"
									aria-label="Choose avatar image"
									className="sr-only"
									onChange={(event) => {
										chooseImage(event.target.files?.[0]);
										event.currentTarget.value = "";
									}}
									ref={fileInput}
									tabIndex={-1}
									type="file"
								/>
							</section>
						</div>
						<aside className="flex flex-col items-center border-border border-t bg-foreground/3 p-5 sm:border-t-0 sm:border-l sm:px-7 sm:pt-12 sm:pb-7">
							<p className="font-medium text-sm max-sm:hidden">
								{input.profileName}
							</p>
							<div className="flex min-h-40 flex-1 items-center justify-center py-5 sm:min-h-60">
								<DraftPreview
									draft={draft}
									live
									profileName={input.profileName}
									saved={savedAvatar}
									size={small ? 104 : 168}
								/>
							</div>
							{draft.kind === "bot" ? (
								<AvatarChoices
									disabled={input.saving}
									items={palettes.map((next) => ({
										value: next,
										label: label(next),
										content: (
											<BotAvatar
												motionEnabled={false}
												palette={next}
												preview
												shading={shading}
												size={40}
												type={draft.type}
											/>
										),
										onSelect: () => setDraft({ ...draft, palette: next }),
									}))}
									label="Bot colors"
									paletteGroup
									selected={draft.palette}
								/>
							) : null}
							<p className="mt-4 mb-5 text-center text-muted-foreground text-xs">
								{draft.kind === "bot" && motionEnabled && !reducedMotion
									? "Move your pointer. Click to animate."
									: "Preview your avatar before saving."}
							</p>
							{error && !cropDraft ? (
								<p className="mb-3 text-destructive text-xs" role="alert">
									{error}
								</p>
							) : null}
							<Button
								className="w-full"
								disabled={
									input.saving || draft.kind === "saved" || same(draft, current)
								}
								onClick={async () => {
									if (draft.kind === "saved") {
										return;
									}
									setError(null);
									try {
										await input.onSave(draft);
										setOpen(false);
									} catch {
										setError("This avatar could not be saved. Try again.");
									}
								}}
							>
								{input.saving ? "Saving…" : "Save"}
							</Button>
						</aside>
					</div>
				</DialogContent>
			</Dialog>
			<IdentityImageCropDialog
				crop={crop}
				description="Adjust the image to fit your avatar."
				draft={cropDraft}
				errorMessage={error}
				isSaving={cropping}
				onCropChange={setCrop}
				onOpenChange={(next) => {
					if (!(next || cropping)) {
						closeCrop();
					}
				}}
				onSave={applyCrop}
				previewAlt="Custom avatar crop"
				previewShape="circle"
				saveLabel="Use image"
				subject="Avatar"
				title="Crop avatar"
			/>
		</>
	);
}

function DraftPreview({
	draft,
	size,
	live,
	saved,
	profileName,
}: {
	draft: Draft;
	size: number;
	live: boolean;
	saved: (size: number) => ReactNode;
	profileName: string;
}) {
	if (draft.kind === "saved") {
		return saved(size);
	}
	const appearance = draftAppearance(draft);
	return (
		<RemoteAgentAvatar
			{...appearance}
			agentControllerRef={HOSTED_CENTER_AGENT_CONTROLLER_REF}
			animated={live}
			clickable={live}
			preview
			profileName={profileName}
			shape="circle"
			size={size}
		/>
	);
}

function AvatarChoices({
	label: groupLabel,
	selected,
	items,
	disabled,
	paletteGroup = false,
}: {
	label: string;
	selected: string;
	disabled: boolean;
	paletteGroup?: boolean;
	items: {
		value: string;
		label: string;
		content: ReactNode;
		onSelect: () => void;
	}[];
}) {
	const ref = useRef<HTMLDivElement>(null);
	const hover = useFluidHover(ref, { axis: "xy", gapClick: false });
	return (
		<ToggleGroup
			ref={ref}
			{...hover.handlers}
			aria-label={groupLabel}
			className={`relative grid w-full gap-2 ${paletteGroup ? "grid-cols-3" : "grid-cols-6"}`}
			disabled={disabled}
			value={selected ? [selected] : []}
		>
			<FluidHoverHighlight
				className="rounded-xl bg-foreground/5"
				hover={hover}
			/>
			{items.map((item, index) => (
				<ToggleGroupItem
					aria-label={item.label}
					className={`relative flex h-auto min-w-0 flex-col rounded-xl border border-transparent bg-transparent p-1 hover:bg-transparent data-pressed:border-foreground/25 data-pressed:bg-foreground/10 ${paletteGroup ? "gap-2 py-3" : "aspect-square"}`}
					key={item.value}
					onClick={item.onSelect}
					ref={(element) => hover.registerItem(index, element)}
					value={item.value}
				>
					{item.content}
					{paletteGroup ? (
						<span className="flex items-center gap-1 text-xs">
							{item.label}
							{selected === item.value ? (
								<CheckIcon className="size-3" />
							) : null}
						</span>
					) : null}
				</ToggleGroupItem>
			))}
		</ToggleGroup>
	);
}

function currentDraft(
	style: AgentAvatarStyle | null | undefined,
	options: AuthProfileView["avatarOptions"]
): Draft {
	if (style === "fluid") {
		return options?.color
			? { kind: "color", color: options.color }
			: { kind: "saved" };
	}
	if (style === "custom") {
		return { kind: "saved" };
	}
	return {
		kind: "bot",
		type: !style || style === "automatic" ? "clover" : style,
		palette: options?.palette ?? "original",
	};
}
function draftAppearance(draft: Selection): {
	avatarStyle: AgentAvatarStyle;
	avatarOptions: AuthProfileView["avatarOptions"];
} {
	if (draft.kind === "bot") {
		return {
			avatarStyle: draft.type,
			avatarOptions: { palette: draft.palette },
		};
	}
	if (draft.kind === "color") {
		return { avatarStyle: "fluid", avatarOptions: { color: draft.color } };
	}
	return { avatarStyle: "custom", avatarOptions: { imageUrl: draft.dataUrl } };
}
