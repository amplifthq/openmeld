"use client";

import {
	type StructuredApiClientFailure,
	toStructuredApiClientFailure,
} from "@openmeld/api-client";
import { MAX_SPACE_GUIDE_LENGTH } from "@openmeld/schemas";
import type { SpaceMeta } from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import { Textarea } from "@openmeld/ui/components/textarea";
import { ScrollArea } from "@openmeld/ui/fluid/scroll-area";
import { BookOpenTextIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ReadPausedState } from "#/components/app/read-paused-state";
import { createUnscopedWebSpaceApi } from "#/lib/spaces/api";
import { useDelayedPending } from "#/lib/use-delayed-pending";
import { shouldRetrySpaceQuery } from "#/query/spaces/retry";
import { spaceQueryKeys } from "#/query/spaces/status";

const GUIDE_LENGTH_FORMAT = new Intl.NumberFormat("en-US");

type SpaceGuideTarget = {
	openMeldProfileId: string;
	spaceId: string;
};

export function SpaceGuidePanel(
	input: SpaceGuideTarget & {
		/** Core authorizes the write; this only decides whether to offer editing. */
		canEdit: boolean;
		/** The unsaved edit, or null when not editing. Owned by the parent. */
		draft: string | null;
		onDraftChange: (draft: string | null) => void;
	}
) {
	// Refetches each time the tab opens, so edits made elsewhere (another
	// owner, or an Agent through Space settings) show up.
	const metaQuery = useQuery<SpaceMeta, StructuredApiClientFailure>({
		queryKey: spaceQueryKeys.meta(input.spaceId, input.openMeldProfileId),
		queryFn: async ({ signal }) => {
			try {
				return await createUnscopedWebSpaceApi({
					openMeldProfileId: input.openMeldProfileId,
				}).getMeta({ spaceId: input.spaceId, signal, timeoutMs: 15_000 });
			} catch (error) {
				throw toStructuredApiClientFailure(error);
			}
		},
		retry: shouldRetrySpaceQuery,
	});
	const showPending = useDelayedPending(
		metaQuery.isPending && metaQuery.fetchStatus !== "paused"
	);

	if (metaQuery.isPending) {
		if (metaQuery.fetchStatus === "paused") {
			return <ReadPausedState subject="Guide" />;
		}
		return showPending ? (
			<p className="p-6 text-muted-foreground text-sm">Loading guide…</p>
		) : null;
	}
	if (metaQuery.isError) {
		return <SpaceGuideLoadError onRetry={() => metaQuery.refetch()} />;
	}

	const guide = metaQuery.data.guide ?? "";
	if (input.canEdit && input.draft !== null) {
		return (
			<SpaceGuideEditor
				draft={input.draft}
				onDraftChange={input.onDraftChange}
				openMeldProfileId={input.openMeldProfileId}
				spaceId={input.spaceId}
			/>
		);
	}
	const onEdit = input.canEdit ? () => input.onDraftChange(guide) : null;
	return guide ? (
		<SpaceGuideReader guide={guide} onEdit={onEdit} />
	) : (
		<SpaceGuideEmpty
			onWrite={input.canEdit ? () => input.onDraftChange("") : null}
		/>
	);
}

function SpaceGuideLoadError(input: { onRetry: () => void }) {
	return (
		<div className="flex min-h-0 flex-1 items-center justify-center p-6">
			<div className="max-w-sm text-center">
				<p className="font-medium text-sm">Guide couldn't load</p>
				<p className="mt-1 text-muted-foreground text-sm">
					OpenMeld couldn't read this Space's guide.
				</p>
				<Button
					className="mt-4"
					onClick={input.onRetry}
					size="sm"
					variant="outline"
				>
					Try again
				</Button>
			</div>
		</div>
	);
}

function SpaceGuideEditor(
	input: SpaceGuideTarget & {
		draft: string;
		onDraftChange: (draft: string | null) => void;
	}
) {
	const queryClient = useQueryClient();
	const saveGuide = useMutation({
		mutationFn: async (guide: string) =>
			await createUnscopedWebSpaceApi({
				openMeldProfileId: input.openMeldProfileId,
			}).updateMeta({ spaceId: input.spaceId, guide }),
		onSuccess: (meta) => {
			queryClient.setQueryData(
				spaceQueryKeys.meta(input.spaceId, input.openMeldProfileId),
				meta
			);
			input.onDraftChange(null);
			toast.success("Guide saved.");
		},
	});
	// The cap only guards storage and Agent context; it is not shown as a
	// running count, so it reads as unlimited until someone actually hits it.
	const length = input.draft.trim().length;
	const tooLong = length > MAX_SPACE_GUIDE_LENGTH;
	return (
		<div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col gap-3 p-4 sm:p-6">
			<Textarea
				aria-describedby={tooLong ? "space-guide-too-long" : undefined}
				aria-invalid={tooLong || undefined}
				aria-label="Space guide"
				autoFocus
				className="min-h-0 flex-1 resize-none font-mono leading-6"
				onChange={(event) => input.onDraftChange(event.target.value)}
				placeholder="Describe this Space's purpose, working rules, and handoff expectations. Agents follow this guide on every Wake in this Space."
				value={input.draft}
			/>
			{tooLong ? (
				<p
					className="text-destructive text-sm"
					id="space-guide-too-long"
					role="alert"
				>
					This guide is {GUIDE_LENGTH_FORMAT.format(length)} characters. Shorten
					it to {GUIDE_LENGTH_FORMAT.format(MAX_SPACE_GUIDE_LENGTH)} or fewer to
					save.
				</p>
			) : null}
			{saveGuide.isError ? (
				<p className="text-destructive text-sm" role="alert">
					{toStructuredApiClientFailure(saveGuide.error).message}
				</p>
			) : null}
			<div className="flex justify-end gap-2">
				<Button
					disabled={saveGuide.isPending}
					onClick={() => {
						saveGuide.reset();
						input.onDraftChange(null);
					}}
					size="sm"
					variant="ghost"
				>
					Cancel
				</Button>
				<Button
					disabled={saveGuide.isPending || tooLong}
					onClick={() => saveGuide.mutate(input.draft)}
					size="sm"
				>
					{saveGuide.isPending ? "Saving…" : "Save"}
				</Button>
			</div>
		</div>
	);
}

function SpaceGuideEmpty(input: { onWrite: (() => void) | null }) {
	return (
		<div className="flex min-h-0 flex-1 items-center justify-center p-6">
			<div className="max-w-md text-center">
				<BookOpenTextIcon
					aria-hidden="true"
					className="mx-auto size-8 text-muted-foreground"
				/>
				<h3 className="mt-3 font-medium text-sm">No guide yet</h3>
				<p className="mt-1 text-muted-foreground text-sm leading-6">
					A guide holds this Space's durable rules. Agents follow it on every
					Wake here.
				</p>
				{input.onWrite ? (
					<Button className="mt-4" onClick={input.onWrite} size="sm">
						Write a guide
					</Button>
				) : null}
			</div>
		</div>
	);
}

function SpaceGuideReader(input: {
	guide: string;
	onEdit: (() => void) | null;
}) {
	return (
		<ScrollArea className="min-h-0 flex-1">
			<div className="mx-auto max-w-3xl p-4 sm:p-6">
				<div className="mb-4 flex items-center justify-between gap-3">
					<p className="text-muted-foreground text-sm">
						Agents follow this guide on every Wake in this Space.
					</p>
					{input.onEdit ? (
						<Button onClick={input.onEdit} size="sm" variant="outline">
							Edit
						</Button>
					) : null}
				</div>
				<div className="whitespace-pre-wrap break-words text-sm leading-6">
					{input.guide}
				</div>
			</div>
		</ScrollArea>
	);
}
