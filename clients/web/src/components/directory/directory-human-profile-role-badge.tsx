import { cn } from "@openmeld/ui/lib/utils";
import { resolveDirectoryRoleLabel } from "#/components/directory/directory-human-profile-format";
import type { DirectoryHumanProfileRow } from "#/components/directory/directory-human-profile-model";

export function DirectoryHumanProfileRoleBadge(input: {
	className?: string;
	role: DirectoryHumanProfileRow["role"];
}) {
	if (input.role === null) {
		return null;
	}
	return (
		<span
			className={cn(
				"inline-flex h-5 shrink-0 items-center rounded-sm border border-border bg-background px-1.5 font-medium text-[0.65rem] text-muted-foreground uppercase leading-none tracking-wide",
				input.className
			)}
			data-slot="human-profile-role-badge"
		>
			{resolveDirectoryRoleLabel(input.role)}
		</span>
	);
}
