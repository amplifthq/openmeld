import { Badge } from "@openmeld/ui/components/badge";
import { cn } from "@openmeld/ui/lib/utils";
import { useEffect, useState } from "react";
import { openMeldAuthClient } from "#/lib/auth-client";

type LastUsedBadgeProps = {
	className?: string;
};

export function LastUsedBadge({ className }: LastUsedBadgeProps) {
	const [isHydrated, setIsHydrated] = useState(false);

	useEffect(() => {
		setIsHydrated(true);
	}, []);

	if (!isHydrated) {
		return null;
	}

	if (typeof window === "undefined") {
		return null;
	}

	const clientWithLastUsed = openMeldAuthClient as unknown as {
		getLastUsedLoginMethod?: () => string | undefined;
	};

	const lastUsed = clientWithLastUsed.getLastUsedLoginMethod?.();

	if (!lastUsed) {
		return null;
	}

	return (
		<Badge
			className={cn(
				"absolute right-3 text-muted-foreground text-xs transition-colors duration-150 group-hover:text-foreground",
				className
			)}
			variant="secondary"
		>
			Last used
		</Badge>
	);
}
