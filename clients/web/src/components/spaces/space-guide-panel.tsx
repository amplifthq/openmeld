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
import { useState } from "react";
import { toast } from "sonner";
import { ReadPausedState } from "#/components/app/read-paused-state";
import { createUnscopedWebSpaceApi } from "#/lib/spaces/api";
import { useDelayedPending } from "#/lib/use-delayed-pending";
import { spaceQueryKeys } from "#/query/spaces/status";
import { shouldRetrySpaceQuery } from "#/query/spaces/retry";

const GUIDE_LENGTH_FORMAT = new Intl.NumberFormat("en-US");

export function SpaceGuidePanel(input: {
	/** Core authorizes the write; this only decides whether to offer editing. */
	canEdit: boolean;
	openMeldProfileId: string;
	spaceId: string;
}) {
	const queryClient = useQueryClient();
	const queryKey = spaceQueryKeys.meta(input.spaceId, input.openMeldProfileId);
	const metaQuery = useQuery<SpaceMeta, StructuredApiClientFailure>({
		queryKey,
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
	const [draft, setDraft] = useState<string | null>(null);
	const saveGuide = useMutation({
		mutationFn: async (guide: string) =>
			await createUnscopedWebSpaceApi({
				openMeldProfileId: input.openMeldProfileId,
			}).updateMeta({ spaceId: input.spaceId, guide }),
		onSuccess: (meta) => {
			queryClient.setQueryData(queryKey, meta);
			setDraft(null);
			toast.success("Guide saved.");
		},
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
		return (
			<div className="flex min-h-0 flex-1 items-center justify-center p-6">
				<div className="max-w-sm text-center">
					<p className="font-medium text-sm">Guide couldn't load</p>
					<p className="mt-1 text-muted-foreground text-sm">
						OpenMeld couldn't read this Space's guide.
					</p>
					<Button
						className="mt-4"
						onClick={() => metaQuery.refetch()}
						size="sm"
						variant="outline"
					>
						Try again
					</Button>
				</div>
			</div>
		);
	}

	const guide = metaQuery.data.guide ?? "";

	if (draft !== null) {
		const tooLong = draft.trim().length > MAX_SPACE_GUIDE_LENGTH;
		return (
			<div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col gap-3 p-4 sm:p-6">
				<Textarea
					aria-label="Space guide"
					autoFocus
					className="min-h-0 flex-1 resize-none font-mono leading-6"
					onChange={(event) => setDraft(event.target.value)}
					placeholder="Describe this Space's purpose, working rules, and handoff expectations. Agents follow this guide on every Wake in this Space."
					value={draft}
				/>
				{saveGuide.isError ? (
					<p className="text-destructive text-sm" role="alert">
						{toStructuredApiClientFailure(saveGuide.error).message}
					</p>
				) : null}
				<div className="flex items-center justify-between gap-3">
					<span
						className={
							tooLong
								? "text-destructive text-xs"
								: "text-muted-foreground text-xs"
						}
					>
						{GUIDE_LENGTH_FORMAT.format(draft.trim().length)} /{" "}
						{GUIDE_LENGTH_FORMAT.format(MAX_SPACE_GUIDE_LENGTH)} characters
					</span>
					<div className="flex gap-2">
						<Button
							disabled={saveGuide.isPending}
							onClick={() => {
								saveGuide.reset();
								setDraft(null);
							}}
							size="sm"
							variant="ghost"
						>
							Cancel
						</Button>
						<Button
							disabled={saveGuide.isPending || tooLong}
							onClick={() => saveGuide.mutate(draft)}
							size="sm"
						>
							{saveGuide.isPending ? "Saving…" : "Save"}
						</Button>
					</div>
				</div>
			</div>
		);
	}

	if (!guide) {
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
					{input.canEdit ? (
						<Button className="mt-4" onClick={() => setDraft("")} size="sm">
							Write a guide
						</Button>
					) : null}
				</div>
			</div>
		);
	}

	return (
		<ScrollArea className="min-h-0 flex-1">
			<div className="mx-auto max-w-3xl p-4 sm:p-6">
				<div className="mb-4 flex items-center justify-between gap-3">
					<p className="text-muted-foreground text-sm">
						Agents follow this guide on every Wake in this Space.
					</p>
					{input.canEdit ? (
						<Button
							onClick={() => setDraft(guide)}
							size="sm"
							variant="outline"
						>
							Edit
						</Button>
					) : null}
				</div>
				<div className="whitespace-pre-wrap break-words text-sm leading-6">
					{guide}
				</div>
			</div>
		</ScrollArea>
	);
}
