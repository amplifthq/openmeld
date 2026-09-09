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
import { MessageActionTooltip } from "./space-message-actions";

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

export function SpaceMessagePinsProvider(input: {
	children: ReactNode;
	spaceId: string;
	profileId: string;
	organizationSlug: string;
	canPin: boolean;
}) {
	const queryClient = useQueryClient();
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
	const mutation = useMutation({
		mutationFn: (value: SpaceMessagePinMutation) =>
			readOrUpdateSpaceMessagePins(createClient(), {
				spaceId: input.spaceId,
				mutation: value,
			}),
		onSuccess: (data) => {
			queryClient.setQueryData(queryKey, data);
		},
		onError: (error) => {
			toast.error(error.message || "Unable to update the pin. Try again.");
		},
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
				{input.children}
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

export function SpacePinnedFileBar(input: {
	onOpen: (fileId: string, revision: number) => void;
}) {
	const context = useContext(FilePinsContext);
	const [selectedId, setSelectedId] = useState<string | null>(null);
	if (!context?.pins.length) {
		return null;
	}
	const index = Math.max(
		0,
		context.pins.findIndex((pin) => pin.file.id === selectedId)
	);
	const pin = context.pins[index];
	if (!pin) {
		return null;
	}
	return (
		<div className="shrink-0 px-3 pt-2 sm:px-5" data-slot="space-pinned-file">
			<Surface className="flex min-w-0 items-center gap-2 px-3 py-2">
				<FileIcon
					aria-hidden="true"
					className="size-4 shrink-0 text-muted-foreground"
				/>
				<button
					className="min-w-0 flex-1 rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					onClick={() =>
						input.onOpen(pin.file.id, pin.file.latestRevision.revision)
					}
					type="button"
				>
					<div className="flex min-w-0 items-center gap-1.5">
						<span className="min-w-0 truncate font-medium text-sm">
							{pin.file.name}
						</span>
						<PinnedFileUpdateBadge pin={pin} scope={context} />
					</div>
					<p className="truncate text-muted-foreground text-xs">
						Pinned file · {pin.pinnedByName}
					</p>
				</button>
				{context.pins.length > 1 ? (
					<div className="flex shrink-0 items-center text-muted-foreground text-xs">
						<PinBarAction
							label="Previous pinned file"
							onClick={() =>
								setSelectedId(
									context.pins[
										(index - 1 + context.pins.length) % context.pins.length
									]?.file.id ?? null
								)
							}
						>
							<CaretLeftIcon />
						</PinBarAction>
						<span className="tabular-nums">
							{index + 1}/{context.pins.length}
						</span>
						<PinBarAction
							label="Next pinned file"
							onClick={() =>
								setSelectedId(
									context.pins[(index + 1) % context.pins.length]?.file.id ??
										null
								)
							}
						>
							<CaretRightIcon />
						</PinBarAction>
					</div>
				) : null}
				<PinBarAction
					label="Open pinned file"
					onClick={() =>
						input.onOpen(pin.file.id, pin.file.latestRevision.revision)
					}
				>
					<ArrowSquareOutIcon />
				</PinBarAction>
				{context.canPin && pin.pinnedByProfileId === context.profileId ? (
					<PinBarAction
						disabled={context.pending}
						label="Unpin file"
						onClick={() =>
							context.mutate({ fileId: pin.file.id, action: "unpin" })
						}
					>
						<XIcon />
					</PinBarAction>
				) : null}
			</Surface>
		</div>
	);
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
	if (pin && pin.pinnedByProfileId !== context.profileId) {
		return undefined;
	}
	return {
		label: pin ? "Unpin message" : "Pin message",
		disabled: context.pending,
		onSelect: () => context.mutate({ signalId, action: pin ? "unpin" : "pin" }),
	};
}

export function SpacePinnedMessageBar(input: {
	onJump: (signalId: string) => void;
}) {
	const context = useContext(PinsContext);
	const [selectedId, setSelectedId] = useState<string | null>(null);
	if (!context?.pins.length) {
		return null;
	}
	const index = Math.max(
		0,
		context.pins.findIndex((pin) => pin.signalId === selectedId)
	);
	const pin = context.pins[index];
	if (!pin) {
		return null;
	}
	return (
		<div
			className="shrink-0 px-3 pt-2 sm:px-5"
			data-slot="space-pinned-message"
		>
			<Surface className="flex min-w-0 items-center gap-2 px-3 py-2">
				<PushPinIcon
					aria-hidden="true"
					className="size-4 shrink-0 text-muted-foreground"
					weight="fill"
				/>
				<div className="min-w-0 flex-1">
					<p className="truncate text-sm">
						<span className="font-medium">{pin.authorName}: </span>
						{pin.preview || "Attachment"}
					</p>
					<p className="truncate text-muted-foreground text-xs">
						Pinned by {pin.pinnedByName}
					</p>
				</div>
				{context.pins.length > 1 ? (
					<div className="flex shrink-0 items-center text-muted-foreground text-xs">
						<PinBarAction
							label="Previous pinned message"
							onClick={() =>
								setSelectedId(
									context.pins[
										(index - 1 + context.pins.length) % context.pins.length
									]?.signalId
								)
							}
						>
							<CaretLeftIcon />
						</PinBarAction>
						<span className="tabular-nums">
							{index + 1}/{context.pins.length}
						</span>
						<PinBarAction
							label="Next pinned message"
							onClick={() =>
								setSelectedId(
									context.pins[(index + 1) % context.pins.length]?.signalId
								)
							}
						>
							<CaretRightIcon />
						</PinBarAction>
					</div>
				) : null}
				<PinBarAction
					label="Jump to message"
					onClick={() => input.onJump(pin.signalId)}
				>
					<ArrowSquareOutIcon />
				</PinBarAction>
				{context.canPin && pin.pinnedByProfileId === context.profileId ? (
					<PinBarAction
						disabled={context.pending}
						label="Unpin message"
						onClick={() =>
							context.mutate({ signalId: pin.signalId, action: "unpin" })
						}
					>
						<XIcon />
					</PinBarAction>
				) : null}
			</Surface>
		</div>
	);
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
