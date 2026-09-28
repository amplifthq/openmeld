"use client";

import { Button } from "@openmeld/ui/components/button";
import { Input } from "@openmeld/ui/components/input";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
	resolveProjectErrorMessage,
	updateCurrentProjectRepositorySettings,
} from "#/lib/organizations/projects";
import {
	projectQueryKeys,
	projectRepositorySettingsQueryOptions,
} from "#/query/organizations/projects";

export function ProjectRepositoriesSection(input: {
	canManage: boolean;
	organizationId: string;
	projectId: string;
}) {
	const queryClient = useQueryClient();
	const query = useQuery(projectRepositorySettingsQueryOptions(input));
	const settings = query.data?.settings;
	const [editing, setEditing] = useState(false);
	const [urls, setUrls] = useState<string[]>([]);
	const [newUrl, setNewUrl] = useState("");
	const [defaultUrl, setDefaultUrl] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const update = useMutation({
		mutationFn: async () => {
			if (!settings) {
				throw new Error("Repository settings are unavailable.");
			}
			return await updateCurrentProjectRepositorySettings({
				defaultRepositoryUrl: defaultUrl,
				expectedOrganizationId: input.organizationId,
				expectedRevision: settings.revision,
				projectId: input.projectId,
				repositoryUrls: urls,
			});
		},
		onError: (failure) =>
			setError(resolveProjectErrorMessage(failure, "update")),
		onSuccess: async (response) => {
			queryClient.setQueryData(
				projectQueryKeys.repositories(input.organizationId, input.projectId),
				response
			);
			await queryClient.invalidateQueries({
				queryKey: projectQueryKeys.organization(input.organizationId),
			});
			setEditing(false);
			setError(null);
		},
	});
	const startEditing = () => {
		if (!settings) {
			return;
		}
		setUrls(
			settings.repositories.map((repository) => repository.repositoryUrl)
		);
		setDefaultUrl(
			settings.repositories.find((repository) => repository.isDefault)
				?.repositoryUrl ?? null
		);
		setNewUrl("");
		setError(null);
		setEditing(true);
	};
	return (
		<section
			aria-labelledby="project-repositories-heading"
			className="grid gap-3 border-t pt-5"
		>
			<div className="flex items-start justify-between gap-3">
				<div>
					<p className="font-medium text-muted-foreground text-xs">
						Code context
					</p>
					<h2 className="font-medium text-xl" id="project-repositories-heading">
						Repositories
					</h2>
				</div>
				{input.canManage && settings && !editing ? (
					<Button onClick={startEditing} size="sm" variant="outline">
						Edit
					</Button>
				) : null}
			</div>
			{query.isPending ? (
				<p className="text-muted-foreground text-sm">Checking repositories…</p>
			) : null}
			{query.isError ? (
				<div className="grid justify-items-start gap-2 text-sm" role="alert">
					<p>{resolveProjectErrorMessage(query.error, "list")}</p>
					<Button onClick={() => query.refetch()} size="sm" variant="outline">
						Try again
					</Button>
				</div>
			) : null}
			{settings && !editing ? (
				<div className="grid gap-2 text-sm">
					{settings.repositories.length === 0 &&
					!settings.legacyDefaultFingerprint ? (
						<p className="text-muted-foreground">
							No code repository is associated. This Project can still organize
							non-code work.
						</p>
					) : null}
					{settings.legacyDefaultFingerprint ? (
						<p className="text-muted-foreground">
							A legacy repository identity is saved without a URL. Edit the
							Project identity to set its URL before changing the repository
							list.
						</p>
					) : null}
					{settings.repositories.map((repository) => (
						<p className="break-all" key={repository.repositoryUrl}>
							<a
								className="underline underline-offset-2"
								href={repository.repositoryUrl}
								rel="noreferrer"
								target="_blank"
							>
								{repository.repositoryUrl}
							</a>
							{repository.isDefault ? " · Default for new code work" : ""}
						</p>
					))}
					{settings.repositories.length > 0 ? (
						<p className="text-muted-foreground text-xs">
							A repository association does not connect a folder or grant code
							access.
						</p>
					) : null}
				</div>
			) : null}
			{editing ? (
				<form
					className="grid max-w-xl gap-3 rounded-md border p-4"
					onSubmit={(event) => {
						event.preventDefault();
						update.mutate();
					}}
				>
					{urls.map((url) => (
						<div className="flex items-center gap-2" key={url}>
							<span className="min-w-0 flex-1 break-all text-sm">{url}</span>
							<Button
								onClick={() => {
									setUrls((current) =>
										current.filter((candidate) => candidate !== url)
									);
									if (defaultUrl === url) {
										setDefaultUrl(null);
									}
								}}
								size="sm"
								type="button"
								variant="outline"
							>
								Remove
							</Button>
						</div>
					))}
					<div className="flex gap-2">
						<Input
							aria-label="Repository URL"
							onChange={(event) => setNewUrl(event.target.value)}
							placeholder="https://github.com/owner/repo"
							value={newUrl}
						/>
						<Button
							disabled={!newUrl.trim() || urls.length >= 12}
							onClick={() => {
								const value = newUrl.trim();
								if (urls.includes(value)) {
									setError("This repository is already associated.");
									return;
								}
								setUrls((current) => [...current, value]);
								setNewUrl("");
								setError(null);
							}}
							type="button"
							variant="outline"
						>
							Add
						</Button>
					</div>
					<label className="grid gap-1 text-sm">
						Default repository for new code work
						<select
							className="h-9 rounded-md border bg-background px-3"
							onChange={(event) => setDefaultUrl(event.target.value || null)}
							value={defaultUrl ?? ""}
						>
							<option value="">No default</option>
							{urls.map((url) => (
								<option key={url} value={url}>
									{url}
								</option>
							))}
						</select>
					</label>
					{error ? (
						<p className="text-destructive text-sm" role="alert">
							{error}
						</p>
					) : null}
					<div className="flex gap-2">
						<Button disabled={update.isPending} size="sm" type="submit">
							{update.isPending ? "Saving…" : "Save repositories"}
						</Button>
						<Button
							disabled={update.isPending}
							onClick={() => setEditing(false)}
							size="sm"
							type="button"
							variant="outline"
						>
							Cancel
						</Button>
					</div>
				</form>
			) : null}
		</section>
	);
}
