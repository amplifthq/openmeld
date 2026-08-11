import type { OrganizationSkill } from "@openmeld/schemas/types";
import { GithubLogoIcon } from "@phosphor-icons/react";

export function OrganizationSkillSourceHistory(input: {
	skill: OrganizationSkill;
}) {
	return (
		<section aria-labelledby="skill-history-heading" className="grid gap-3">
			<div>
				<h2 className="font-medium text-lg" id="skill-history-heading">
					Source and releases
				</h2>
				<p className="mt-1 text-muted-foreground text-sm">
					Every Save creates an immutable release. Existing work keeps the
					release it started with.
				</p>
			</div>
			{input.skill.source.kind === "github" ? (
				<a
					className="inline-flex items-center gap-2 justify-self-start text-sm underline underline-offset-4"
					href={`${input.skill.source.repository}/tree/${input.skill.source.commitSha}/${input.skill.source.path}`}
					rel="noreferrer"
					target="_blank"
				>
					<GithubLogoIcon aria-hidden="true" />
					Based on GitHub commit {input.skill.source.commitSha.slice(0, 12)}
				</a>
			) : (
				<p className="text-muted-foreground text-sm">Created in OpenMeld.</p>
			)}
			<div className="grid overflow-hidden rounded-md border">
				{input.skill.releases.map((release) => (
					<div
						className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3 text-sm last:border-b-0"
						key={release.id}
					>
						<div>
							<p className="font-medium">
								{release.id === input.skill.activeRelease.id
									? "Current release"
									: "Previous release"}
							</p>
							<p className="mt-1 text-muted-foreground text-xs">
								{new Intl.DateTimeFormat("en-US", {
									dateStyle: "medium",
									timeStyle: "short",
								}).format(new Date(release.createdAt))}
							</p>
						</div>
						<code className="text-muted-foreground text-xs">
							{release.digest.slice(0, 12)}
						</code>
					</div>
				))}
			</div>
		</section>
	);
}
