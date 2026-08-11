export function SelectedLocalFolder(input: { path: string; testId?: string }) {
	return (
		<div
			className="grid gap-1 rounded-md border border-border/70 bg-muted/20 p-3"
			data-testid={input.testId}
		>
			<p className="font-medium text-xs">Selected folder</p>
			<p className="font-medium text-sm">
				{resolveLocalFolderName(input.path)}
			</p>
			<p className="break-all font-mono text-muted-foreground text-xs">
				{input.path}
			</p>
		</div>
	);
}

function resolveLocalFolderName(path: string): string {
	const segments = path.split(LOCAL_FOLDER_SEPARATOR_PATTERN);
	return segments.at(-1) || path;
}
const LOCAL_FOLDER_SEPARATOR_PATTERN = /[\\/]/u;
