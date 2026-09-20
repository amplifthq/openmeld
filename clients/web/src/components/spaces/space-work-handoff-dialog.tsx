"use client";

import { postSpaceWorkHandoff, type SpaceApi } from "@openmeld/api-client";
import {
	SPACE_FILE_RAW_UPLOAD_MAX_BYTES,
	type SpaceWorkHandoff,
	spaceWorkHandoffSchema,
} from "@openmeld/schemas";
import type { SpaceFileDescriptor } from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@openmeld/ui/components/dialog";
import { Input } from "@openmeld/ui/components/input";
import { Textarea } from "@openmeld/ui/components/textarea";
import { useQuery } from "@tanstack/react-query";
import { useId, useRef, useState } from "react";
import { listCurrentOrganizationSkills } from "#/lib/organizations/organization-skills";

export function SpaceWorkHandoffDialog(input: {
	api: SpaceApi;
	spaceId: string;
	organizationId: string;
	profileId?: string;
	files: readonly SpaceFileDescriptor[];
	onClose(): void;
}) {
	const id = useId();
	const [files] = useState(input.files);
	const [selected, setSelected] = useState<string[]>([]);
	const [skills, setSkills] = useState<SpaceWorkHandoff["skills"]>([]);
	const [target, setTarget] = useState("");
	const [goal, setGoal] = useState("");
	const [completed, setCompleted] = useState("");
	const [nextSteps, setNextSteps] = useState("");
	const [requirements, setRequirements] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);
	const [posted, setPosted] = useState(false);
	const attempt = useRef<{ fingerprint: string; id: string } | null>(null);
	const directory = useQuery({
		queryKey: [
			"space-handoff-members",
			input.organizationId,
			input.spaceId,
			input.profileId,
		],
		queryFn: () => input.api.getMemberDirectory({ spaceId: input.spaceId }),
	});
	const availableSkills = useQuery({
		queryKey: ["space-handoff-skills", input.organizationId],
		queryFn: () =>
			listCurrentOrganizationSkills({ organizationId: input.organizationId }),
	});
	const submit = async () => {
		setError(null);
		try {
			const handoff = spaceWorkHandoffSchema.parse({
				schemaVersion: 1,
				files: files
					.filter((file) => selected.includes(file.id))
					.map((file) => ({
						fileId: file.id,
						revision: file.latestRevision.revision,
						relativePath: file.name,
					})),
				skills,
				work: {
					goal: goal.trim(),
					completed: completed.trim(),
					nextSteps: nextSteps.trim(),
				},
				requirements: requirements
					.split("\n")
					.map((line) => line.trim())
					.filter(Boolean),
			});
			const fingerprint = JSON.stringify({ target, handoff });
			if (attempt.current?.fingerprint !== fingerprint) {
				attempt.current = { fingerprint, id: crypto.randomUUID() };
			}
			setPending(true);
			await postSpaceWorkHandoff(input.api, {
				spaceId: input.spaceId,
				targetProfileId: target,
				clientMessageId: attempt.current.id,
				handoff,
			});
			setPosted(true);
		} catch (failure) {
			setError(
				failure instanceof Error
					? failure.message
					: "The handoff could not be posted. Your selection is still here."
			);
		} finally {
			setPending(false);
		}
	};
	return (
		<Dialog
			onOpenChange={(open) => {
				if (!(open || pending)) {
					input.onClose();
				}
			}}
			open
		>
			<DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>Hand off selected work</DialogTitle>
					<DialogDescription>
						Continue with another Agent in this Space. Only the selected
						versions are sent.
					</DialogDescription>
				</DialogHeader>
				{posted ? (
					<output className="text-sm">
						Handoff posted. Open Messages to see whether the Agent is queued,
						running, or needs attention.
					</output>
				) : (
					<form
						className="space-y-4"
						id="space-work-handoff"
						onSubmit={(event) => {
							event.preventDefault();
							submit().catch(() => undefined);
						}}
					>
						<fieldset className="space-y-4" disabled={pending}>
							<fieldset className="space-y-2">
								<legend className="mb-2 font-medium text-sm">
									Files in this folder
								</legend>
								{files.length ? (
									files.map((file) => (
										<label
											className="flex items-center gap-2 text-sm"
											key={file.id}
										>
											<input
												checked={selected.includes(file.id)}
												disabled={
													file.latestRevision.sizeBytes >
														SPACE_FILE_RAW_UPLOAD_MAX_BYTES ||
													(!selected.includes(file.id) && selected.length >= 10)
												}
												onChange={(event) =>
													setSelected(
														event.target.checked
															? [...selected, file.id]
															: selected.filter((id) => id !== file.id)
													)
												}
												type="checkbox"
											/>
											<span className="min-w-0 break-all">{file.name}</span>
											<span className="shrink-0 text-muted-foreground text-xs">
												{file.latestRevision.sizeBytes >
												SPACE_FILE_RAW_UPLOAD_MAX_BYTES
													? "Over 10 MiB"
													: `Version ${file.latestRevision.revision}`}
											</span>
										</label>
									))
								) : (
									<p className="text-muted-foreground text-sm">
										Upload a file first.
									</p>
								)}
							</fieldset>
							<label className="block space-y-1 text-sm">
								<span>Continue with</span>
								<select
									className="w-full rounded-md border bg-background px-3 py-2"
									onChange={(event) => setTarget(event.target.value)}
									required
									value={target}
								>
									<option value="">Choose an Agent</option>
									{directory.data?.members
										.filter(
											(member) =>
												member.profileKind === "agent" &&
												member.allowedRelations.wake
										)
										.map((member) => (
											<option key={member.profileId} value={member.profileId}>
												{member.displayName}
											</option>
										))}
								</select>
							</label>
							{directory.isError ? (
								<p className="text-destructive text-sm" role="alert">
									Agents could not be loaded.{" "}
									<button
										className="underline"
										onClick={() => directory.refetch()}
										type="button"
									>
										Retry
									</button>
								</p>
							) : null}
							<p className="text-muted-foreground text-xs">
								Local continuation currently requires Codex App Server on macOS.
								Hosted Agents use their existing Computer. Wake permissions and
								availability still apply.
							</p>
							<label className="block space-y-1 text-sm" htmlFor={`${id}-goal`}>
								<span>Goal</span>
								<Input
									id={`${id}-goal`}
									maxLength={4000}
									onChange={(event) => setGoal(event.target.value)}
									required
									value={goal}
								/>
							</label>
							<label
								className="block space-y-1 text-sm"
								htmlFor={`${id}-completed`}
							>
								<span>
									Work completed{" "}
									<span className="text-muted-foreground">(optional)</span>
								</span>
								<Textarea
									id={`${id}-completed`}
									maxLength={4000}
									onChange={(event) => setCompleted(event.target.value)}
									value={completed}
								/>
							</label>
							<label className="block space-y-1 text-sm" htmlFor={`${id}-next`}>
								<span>Next steps</span>
								<Textarea
									id={`${id}-next`}
									maxLength={4000}
									onChange={(event) => setNextSteps(event.target.value)}
									required
									value={nextSteps}
								/>
							</label>
							<details>
								<summary className="cursor-pointer text-sm">
									Skills and requirements
								</summary>
								<div className="mt-3 space-y-3">
									{availableSkills.data?.skills
										.filter((skill) => skill.enabled)
										.map((skill) => (
											<label
												className="flex items-center gap-2 text-sm"
												key={skill.id}
											>
												<input
													checked={skills.some(
														(item) => item.skillId === skill.id
													)}
													disabled={
														skills.length >= 10 &&
														!skills.some((item) => item.skillId === skill.id)
													}
													onChange={(event) =>
														setSkills(
															event.target.checked
																? [
																		...skills,
																		{
																			skillId: skill.id,
																			releaseId: skill.activeRelease.id,
																			digest: skill.activeRelease.digest,
																			name: skill.name,
																		},
																	]
																: skills.filter(
																		(item) => item.skillId !== skill.id
																	)
														)
													}
													type="checkbox"
												/>
												{skill.name}
											</label>
										))}
									{availableSkills.isError ? (
										<p className="text-sm">
											Skills could not be loaded.{" "}
											<button
												className="underline"
												onClick={() => availableSkills.refetch()}
												type="button"
											>
												Retry
											</button>
										</p>
									) : null}
									<label
										className="block space-y-1 text-sm"
										htmlFor={`${id}-requirements`}
									>
										<span>
											Required tools or setup notes{" "}
											<span className="text-muted-foreground">
												(one per line)
											</span>
										</span>
										<Textarea
											id={`${id}-requirements`}
											maxLength={5000}
											onChange={(event) => setRequirements(event.target.value)}
											value={requirements}
										/>
									</label>
								</div>
							</details>
						</fieldset>
						{error ? (
							<p className="break-words text-destructive text-sm" role="alert">
								{error}
							</p>
						) : null}
					</form>
				)}
				<DialogFooter>
					<Button
						disabled={pending}
						onClick={input.onClose}
						type="button"
						variant="outline"
					>
						{posted ? "Close" : "Cancel"}
					</Button>
					{posted ? null : (
						<Button
							disabled={pending || !selected.length || !target}
							form="space-work-handoff"
							type="submit"
						>
							{pending ? "Posting handoff…" : "Hand off"}
						</Button>
					)}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
