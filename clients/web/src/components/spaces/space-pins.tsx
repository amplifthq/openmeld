import {
	readOrUpdateSpaceFilePins,
	readOrUpdateSpaceMessagePins,
} from "@openmeld/api-client";
import type {
	SpaceFilePinMutation,
	SpaceFilePinsResponse,
	SpaceMessagePinMutation,
	SpaceMessagePinsResponse,
} from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuTrigger,
} from "@openmeld/ui/components/dropdown-menu";
import {
	FluidDropdownMenuContent,
	FluidDropdownMenuItem,
} from "@openmeld/ui/fluid/dropdown-menu";
import { Surface } from "@openmeld/ui/fluid/surface";
import {
	ArrowSquareOutIcon,
	CaretLeftIcon,
	CaretRightIcon,
	FileIcon,
	PushPinIcon,
	XIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, type ReactNode, useContext, useState } from "react";
import { toast } from "sonner";
import { createOrganizationScopedWebOpenMeldApiFoundation } from "#/lib/openmeld-api/client";
import {
	hasUnseenPinnedFileUpdate,
	useSeenFileRevision,
} from "#/lib/spaces/file-update-seen";
import { useBrowserPreference } from "#/lib/use-browser-preference";
import { MessageActionTooltip } from "./space-message-actions";

const PinVisibilityContext = createContext<{
	dismissed: boolean;
	setDismissed: (value: boolean) => void;
} | null>(null);

export function SpacePinsRecallAction(input: { onRecall?: () => void } = {}) {
	const messages = useContext(PinsContext);
	const files = useContext(FilePinsContext);
	const visibility = useContext(PinVisibilityContext);
	const count = (messages?.pins.length ?? 0) + (files?.pins.length ?? 0);
	if (!(visibility?.dismissed && count)) {
		return null;
	}
	return (
		<Button
			aria-label="Show pinned items"
			className="gap-1.5 px-2 text-muted-foreground"
			onClick={() => {
				visibility.setDismissed(false);
				input.onRecall?.();
			}}
			size="sm"
			variant="ghost"
		>
			<PushPinIcon className="size-4" />
			<span className="hidden sm:inline">Pinned</span>
		</Button>
	);
}

export function SpacePinnedItemsBar(input: {
	onJump: (signalId: string) => void;
	onOpen: (fileId: string, revision: number) => void;
}) {
	const messages = useContext(PinsContext);
	const files = useContext(FilePinsContext);
	const visibility = useContext(PinVisibilityContext);
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const items = [
		...(files?.pins ?? []).map((pin) => ({
			kind: "file" as const,
			id: `file:${pin.file.id}`,
			pin,
		})),
		...(messages?.pins ?? []).map((pin) => ({
			kind: "message" as const,
			id: `message:${pin.signalId}`,
			pin,
		})),
	];
	const index = Math.max(
		0,
		items.findIndex((item) => item.id === selectedId)
	);
	const item = items[index];
	if (!item || visibility?.dismissed) {
		return null;
	}
	const context = item.kind === "file" ? files : messages;
	const canUnpin =
		context?.canPin && item.pin.pinnedByProfileId === context.profileId;
	const dismiss = () => visibility?.setDismissed(true);
	const unpin = () => {
		if (item.kind === "file") {
			files?.mutate({ fileId: item.pin.file.id, action: "unpin" });
		} else {
			messages?.mutate({ signalId: item.pin.signalId, action: "unpin" });
		}
	};
	const open = () => {
		if (item.kind === "file") {
			input.onOpen(item.pin.file.id, item.pin.file.latestRevision.revision);
		} else {
			input.onJump(item.pin.signalId);
		}
	};
	return (
		<div className="shrink-0 px-3 pt-2 sm:px-5" data-slot="space-pinned-items">
			<Surface className="flex min-w-0 items-center gap-2 px-3 py-2">
				{item.kind === "file" ? (
					<FileIcon
						aria-hidden="true"
						className="size-4 shrink-0 text-muted-foreground"
					/>
				) : (
					<PushPinIcon
						aria-hidden="true"
						className="size-4 shrink-0 text-muted-foreground"
						weight="fill"
					/>
				)}
				<button
					className="min-w-0 flex-1 rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					onClick={open}
					type="button"
				>
					<span className="flex min-w-0 items-center gap-1.5">
						<span className="min-w-0 truncate text-sm">
							{item.kind === "file" ? (
								item.pin.file.name
							) : (
								<>
									<span className="font-medium">{item.pin.authorName}: </span>
									{item.pin.preview || "Attachment"}
								</>
							)}
						</span>
						{item.kind === "file" && files ? (
							<PinnedFileUpdateBadge pin={item.pin} scope={files} />
						) : null}
					</span>
					<span className="block truncate text-muted-foreground text-xs">
						Pinned by {item.pin.pinnedByName}
					</span>
				</button>
				{items.length > 1 ? (
					<div className="flex shrink-0 items-center text-muted-foreground text-xs">
						<PinBarAction
							label="Previous pinned item"
							onClick={() =>
								setSelectedId(
									items[(index - 1 + items.length) % items.length]?.id ?? null
								)
							}
						>
							<CaretLeftIcon />
						</PinBarAction>
						<span className="tabular-nums">
							{index + 1}/{items.length}
						</span>
						<PinBarAction
							label="Next pinned item"
							onClick={() =>
								setSelectedId(items[(index + 1) % items.length]?.id ?? null)
							}
						>
							<CaretRightIcon />
						</PinBarAction>
					</div>
				) : null}
				{canUnpin ? (
					<DropdownMenu>
						<DropdownMenuTrigger
							render={
								<Button
									aria-label="Pinned item options"
									className="size-7 shrink-0 text-muted-foreground shadow-none"
									size="icon-sm"
									variant="ghost"
								/>
							}
						>
							<XIcon />
						</DropdownMenuTrigger>
						<FluidDropdownMenuContent align="end">
							<FluidDropdownMenuItem index={0} onClick={dismiss}>
								Dismiss
							</FluidDropdownMenuItem>
							<FluidDropdownMenuItem
								disabled={context.pending}
								index={1}
								onClick={unpin}
							>
								{item.kind === "file" ? "Unpin file" : "Unpin message"}
							</FluidDropdownMenuItem>
						</FluidDropdownMenuContent>
					</DropdownMenu>
				) : (
					<PinBarAction label="Dismiss pinned items" onClick={dismiss}>
						<XIcon />
					</PinBarAction>
				)}
				<PinBarAction
					label={item.kind === "file" ? "Open pinned file" : "Jump to message"}
					onClick={open}
				>
					<ArrowSquareOutIcon />
				</PinBarAction>
			</Surface>
		</div>
	);
}
type PinsContextValue = {
	pins: SpaceMessagePinsResponse["pins"];
	profileId: string;
	canPin: boolean;
	pending: boolean;
	mutate: (input: SpaceMessagePinMutation) => void;
};
const PinsContext = createContext<PinsContextValue | null>(null);
type FilePinsContextValue = Omit<PinsContextValue, "pins" | "mutate"> & {
	spaceId: string;
	organizationSlug: string;
	pins: SpaceFilePinsResponse["pins"];
	mutate: (input: SpaceFilePinMutation) => void;
};
const FilePinsContext = createContext<FilePinsContextValue | null>(null);
export const spaceMessagePinsQueryKey = (spaceId: string) =>
	["space-message-pins", spaceId] as const;

type SpacePinsProviderProps = {
	children: ReactNode;
	spaceId: string;
	profileId: string;
	organizationSlug?: string;
	canPin: boolean;
};
export function SpacePinsProvider(input: SpacePinsProviderProps) {
	if (!input.organizationSlug) {
		return input.children;
	}
	return (
		<SpacePinsProviderContent
			{...input}
			canPin={input.canPin && !input.profileId.startsWith("agt_")}
			organizationSlug={input.organizationSlug}
		/>
	);
}
function SpacePinsProviderContent(
	input: SpacePinsProviderProps & { organizationSlug: string }
) {
	const queryClient = useQueryClient();
	const [visibility, setVisibility] = useBrowserPreference(
		`openmeld:pins:${JSON.stringify([input.organizationSlug, input.profileId, input.spaceId])}`
	);
	const createClient = () =>
		createOrganizationScopedWebOpenMeldApiFoundation({
			organizationSlug: input.organizationSlug,
			openMeldProfileId: input.profileId,
		});
	const queryKey = [
		...spaceMessagePinsQueryKey(input.spaceId),
		input.profileId,
		input.organizationSlug,
	];
	const query = useQuery({
		queryKey,
		queryFn: ({ signal }) =>
			readOrUpdateSpaceMessagePins(createClient(), {
				spaceId: input.spaceId,
				signal,
			}),
		staleTime: 0,
	});
	const fileQueryKey = [
		"space-file-pins",
		input.spaceId,
		input.profileId,
		input.organizationSlug,
	];
	const fileQuery = useQuery({
		queryKey: fileQueryKey,
		queryFn: ({ signal }) =>
			readOrUpdateSpaceFilePins(createClient(), {
				spaceId: input.spaceId,
				signal,
			}),
		staleTime: 0,
	});
	const fileMutation = useMutation({
		mutationFn: (value: SpaceFilePinMutation) =>
			readOrUpdateSpaceFilePins(createClient(), {
				spaceId: input.spaceId,
				mutation: value,
			}),
		onSuccess: (data) => queryClient.setQueryData(fileQueryKey, data),
		onError: (error) =>
			toast.error(error.message || "Unable to update the file pin. Try again."),
	});
	const updateMessagePin = async (value: SpaceMessagePinMutation) => {
		const data = await readOrUpdateSpaceMessagePins(createClient(), {
			spaceId: input.spaceId,
			mutation: value,
		});
		queryClient.setQueryData(queryKey, data);
		return data;
	};
	const showPinError = (error: Error) => {
		toast.error(error.message || "Unable to update the pin. Try again.");
	};
	const mutation = useMutation({
		mutationFn: updateMessagePin,
		onSuccess: (_data, value) => {
			if (value.action === "pin") {
				toast.success("Message pinned", {
					action: {
						label: "Undo",
						onClick: () => {
							updateMessagePin({
								signalId: value.signalId,
								action: "unpin",
							}).catch(showPinError);
						},
					},
				});
			}
		},
		onError: showPinError,
	});
	return (
		<FilePinsContext.Provider
			value={{
				spaceId: input.spaceId,
				organizationSlug: input.organizationSlug,
				pins: fileQuery.data?.pins ?? [],
				profileId: input.profileId,
				canPin: input.canPin && !fileQuery.isError && !fileQuery.isPending,
				pending: fileMutation.isPending,
				mutate: (value) => fileMutation.mutate(value),
			}}
		>
			<PinsContext.Provider
				value={{
					pins: query.data?.pins ?? [],
					profileId: input.profileId,
					canPin: input.canPin && !query.isError && !query.isPending,
					pending: mutation.isPending,
					mutate: (value) => mutation.mutate(value),
				}}
			>
				<PinVisibilityContext.Provider
					value={{
						dismissed: visibility === "hidden",
						setDismissed: (value) =>
							setVisibility(value ? "hidden" : "visible"),
					}}
				>
					{input.children}
				</PinVisibilityContext.Provider>
			</PinsContext.Provider>
		</FilePinsContext.Provider>
	);
}

export function useSpaceFilePinAction(fileId: string | undefined) {
	const context = useContext(FilePinsContext);
	if (!(context?.canPin && fileId)) {
		return undefined;
	}
	const pin = context.pins.find((item) => item.file.id === fileId);
	if (pin && pin.pinnedByProfileId !== context.profileId) {
		return undefined;
	}
	return {
		label: pin ? "Unpin file" : "Pin file",
		disabled: context.pending,
		onSelect: () => context.mutate({ fileId, action: pin ? "unpin" : "pin" }),
	};
}

function PinnedFileUpdateBadge(input: {
	pin: SpaceFilePinsResponse["pins"][number];
	scope: Pick<
		FilePinsContextValue,
		"profileId" | "organizationSlug" | "spaceId"
	>;
}) {
	const seenRevision = useSeenFileRevision({
		...input.scope,
		fileId: input.pin.file.id,
	});
	if (
		!hasUnseenPinnedFileUpdate({
			pinnedAt: input.pin.pinnedAt,
			revisionCreatedAt: input.pin.file.latestRevision.createdAt,
			latestRevision: input.pin.file.latestRevision.revision,
			seenRevision,
		})
	) {
		return null;
	}
	return (
		<Surface
			className="shrink-0 px-1.5 py-0.5 font-medium text-[10px] leading-3"
			data-slot="pinned-file-update-badge"
		>
			New updates
		</Surface>
	);
}

export function useSpaceMessagePinAction(signalId: string | undefined) {
	const context = useContext(PinsContext);
	if (!(context?.canPin && signalId)) {
		return undefined;
	}
	const pin = context.pins.find((item) => item.signalId === signalId);
	if (pin) {
		return undefined;
	}
	return {
		label: "Pin message",
		disabled: context.pending,
		onSelect: () => context.mutate({ signalId, action: "pin" }),
	};
}

function PinBarAction(input: {
	label: string;
	onClick: () => void;
	disabled?: boolean;
	children: ReactNode;
}) {
	return (
		<MessageActionTooltip label={input.label}>
			<Button
				aria-label={input.label}
				className="size-7 shrink-0 text-muted-foreground shadow-none"
				disabled={input.disabled}
				onClick={input.onClick}
				size="icon-sm"
				variant="ghost"
			>
				{input.children}
			</Button>
		</MessageActionTooltip>
	);
}
