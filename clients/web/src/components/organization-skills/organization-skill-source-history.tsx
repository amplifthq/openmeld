import type { OrganizationSkill } from "@openmeld/schemas/types";
import { Badge } from "@openmeld/ui/components/badge";
import { GithubLogoIcon } from "@phosphor-icons/react";

export function OrganizationSkillSourceHistory(input: {
	skill: OrganizationSkill;
}) {
	return (
		<section aria-labelledby="skill-history-heading" className="grid gap-3">
			<h3 className="sr-only" id="skill-history-heading">
				Saved versions
			</h3>
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
			<ol className="divide-y border-y">
				{input.skill.releases.map((release) => (
					<li className="grid gap-3 py-3 text-sm" key={release.id}>
						<div className="flex flex-wrap items-center justify-between gap-2">
							<time dateTime={release.createdAt}>
								{new Intl.DateTimeFormat("en-US", {
									dateStyle: "medium",
									timeStyle: "short",
								}).format(new Date(release.createdAt))}
							</time>
							{release.id === input.skill.activeRelease.id && (
								<Badge variant="secondary">Current</Badge>
							)}
						</div>
						<details>
							<summary className="cursor-pointer text-muted-foreground text-xs">
								Release details
							</summary>
							<dl className="mt-2 grid gap-2 break-all text-xs">
								<div>
									<dt className="text-muted-foreground">Release ID</dt>
									<dd className="font-mono">{release.id}</dd>
								</div>
								<div>
									<dt className="text-muted-foreground">Digest</dt>
									<dd className="font-mono">{release.digest}</dd>
								</div>
								{release.source.kind === "github" && (
									<div>
										<dt className="text-muted-foreground">GitHub commit</dt>
										<dd className="font-mono">{release.source.commitSha}</dd>
									</div>
								)}
							</dl>
						</details>
					</li>
				))}
			</ol>
		</section>
	);
}
