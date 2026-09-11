import type { ReactNode } from "react";

/** Identity header shared by persistent cards and transient Profile details. */
export function ProfileCardHeader(input: {
	avatar: ReactNode;
	name: string;
	badge?: ReactNode;
	action?: ReactNode;
	children?: ReactNode;
}) {
	return (
		<div className="flex min-w-0 items-start gap-3">
			{input.avatar}
			<div className="min-w-0 flex-1 pt-0.5">
				<p className="break-words font-semibold text-base text-foreground">
					<span className="min-w-0 break-words">{input.name}</span>
					{input.badge}
				</p>
				{input.children}
			</div>
			{input.action}
		</div>
	);
}
