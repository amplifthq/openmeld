import type { OrganizationSkillGitHubPreview } from "@openmeld/schemas/types";

export function GitHubSkillPreview({
	preview,
}: {
	preview: OrganizationSkillGitHubPreview;
}) {
	return (
		<div className="grid min-w-0 gap-4 text-sm">
			<div>
				<h3 className="break-words font-medium text-lg">
					{preview.portable.name}
				</h3>
				<p className="mt-1 whitespace-pre-wrap break-words text-muted-foreground">
					{preview.portable.description}
				</p>
			</div>
			<dl className="grid gap-3 border-y py-3">
				<div>
					<dt className="text-muted-foreground text-xs">Source</dt>
					<dd className="break-all">
						{preview.source.repository}
						<br />
						{preview.source.path}
					</dd>
				</div>
				<div>
					<dt className="text-muted-foreground text-xs">Commit</dt>
					<dd>
						<code>{preview.source.commitSha.slice(0, 12)}</code>
					</dd>
				</div>
				<div>
					<dt className="text-muted-foreground text-xs">Supporting files</dt>
					<dd>
						{preview.files.length === 0
							? "No supporting files"
							: `${preview.files.length} ${preview.files.length === 1 ? "file" : "files"}`}
					</dd>
				</div>
			</dl>
			<p className="text-muted-foreground text-xs">
				File sizes come from GitHub. File contents are checked when you install.
			</p>
			{preview.warnings.length > 0 && (
				<section
					aria-label="Import warnings"
					className="grid gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3"
				>
					<h4 className="font-medium">Before you install</h4>
					{preview.warnings.map((warning) => (
						<p key={warning}>{warning}</p>
					))}
				</section>
			)}
			<details>
				<summary className="min-h-11 cursor-pointer py-3 text-muted-foreground">
					Technical details
				</summary>
				<dl className="grid gap-3 break-words">
					<div>
						<dt className="text-muted-foreground">Instructions</dt>
						<dd>
							{preview.instructionsCharacters.toLocaleString("en-US")}{" "}
							characters
						</dd>
					</div>
					<div>
						<dt className="text-muted-foreground">License</dt>
						<dd>{preview.portable.license ?? "Not specified"}</dd>
					</div>
					<div>
						<dt className="text-muted-foreground">Full commit</dt>
						<dd className="break-all font-mono text-xs">
							{preview.source.commitSha}
						</dd>
					</div>
				</dl>
				<ul className="mt-3 divide-y">
					{preview.files.map((file) => (
						<li
							className="flex flex-wrap justify-between gap-2 py-2"
							key={file.path}
						>
							<span className="break-all">{file.path}</span>
							<span className="text-muted-foreground text-xs">
								{file.size.toLocaleString("en-US")} B
							</span>
						</li>
					))}
				</ul>
			</details>
		</div>
	);
}
