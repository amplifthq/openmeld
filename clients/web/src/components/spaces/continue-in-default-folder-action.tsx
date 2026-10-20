"use client";

import { Button } from "@openmeld/ui/components/button";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useRef, useState } from "react";
import { buildAgentProfileFolderRows } from "#/components/profiles/agent-profile-folders-model";
import { createUnscopedWebSpaceApi } from "#/lib/spaces/api";
import {
	type FolderContinueSource,
	postContinueInDefaultFolder,
} from "#/lib/spaces/continue-in-default-folder";
import { agentProfileFoldersQueryOptions } from "#/query/profiles/agent-profile-folders";
import { spaceQueryKeys } from "#/query/spaces/status";
import { useOptionalSpaceAgentProfileEditContext } from "./space-agent-profile-edit-context";

/** The failed request and where its continuation is posted. */
export type FolderContinueTarget = {
	profileId?: string;
	source: FolderContinueSource | null;
	spaceId: string;
	spacePassword?: string;
};

const FolderContinueContext = createContext<FolderContinueTarget | null>(null);
export const FolderContinueProvider = FolderContinueContext.Provider;

export function useFolderContinueTarget(): FolderContinueTarget | null {
	return useContext(FolderContinueContext);
}

/**
 * Owner-only: continue this chat in a new Session in the Agent's current
 * default folder. The earlier Session keeps its folder; nothing moves it.
 */
export function ContinueInDefaultFolderAction(input: {
	className?: string;
	targetProfileId?: string;
}) {
	const target = useFolderContinueTarget();
	const edit = useOptionalSpaceAgentProfileEditContext();
	const profile = input.targetProfileId
		? edit?.profilesById.get(input.targetProfileId)
		: undefined;
	const storageScope = edit?.context?.storageScope ?? "";
	const organizationId = edit?.context?.organizationId ?? "";
	const folders = useQuery(
		agentProfileFoldersQueryOptions({
			enabled: Boolean(profile && storageScope && organizationId),
			organizationId,
			profileId: input.targetProfileId ?? "",
			storageScope,
		})
	);
	const queryClient = useQueryClient();
	const [pending, setPending] = useState(false);
	const [sent, setSent] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const sending = useRef(false);
	if (
		!(profile && input.targetProfileId && target?.source && target.profileId)
	) {
		// Only the owner chooses folders; anyone else starts a new chat.
		return null;
	}
	const response = folders.data;
	// Name the folder only from a projection the Service just confirmed; a
	// recorded one may predate another default change.
	const folderName =
		response?.status === "current"
			? (buildAgentProfileFolderRows({
					defaultProjectId: profile.defaultProjectId,
					projection: response.projection,
				}).find((row) => row.effectiveDefault)?.displayName ?? null)
			: null;
	const label = folderName
		? `Continue in ${folderName}`
		: "Continue in the default folder";
	const { profileId, source, spaceId, spacePassword } = target;
	const targetProfileId = input.targetProfileId;
	const send = async () => {
		if (sending.current) {
			return;
		}
		sending.current = true;
		setPending(true);
		setError(null);
		try {
			await postContinueInDefaultFolder({
				api: createUnscopedWebSpaceApi({ openMeldProfileId: profileId }),
				profileId,
				source,
				spaceId,
				spacePassword,
				targetProfileId,
			});
			setSent(true);
			await queryClient.invalidateQueries({
				queryKey: spaceQueryKeys.history(spaceId, profileId),
			});
		} catch (failure) {
			setError(
				failure instanceof Error
					? failure.message
					: "The new session could not be confirmed. Try again to check the same request."
			);
		} finally {
			sending.current = false;
			setPending(false);
		}
	};
	if (sent) {
		return (
			<output className="text-muted-foreground text-sm">
				Continuing in a new session. Follow its progress in this chat.
			</output>
		);
	}
	return (
		<div className="grid gap-1">
			<Button
				className={input.className}
				disabled={pending}
				onClick={send}
				size="sm"
				type="button"
				variant="outline"
			>
				{pending ? "Starting…" : label}
			</Button>
			{error ? (
				<p className="text-destructive text-xs" role="alert">
					{error}
				</p>
			) : null}
		</div>
	);
}
