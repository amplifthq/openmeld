"use client";

import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import type { DirectoryIdentityAccount } from "#/components/directory/directory-human-profile-model";

type DirectoryIdentityAccountActionKind = NonNullable<
	DirectoryIdentityAccount["action"]
>["kind"];

export function DirectoryIdentityAccountActionLink(input: {
	actionKind: DirectoryIdentityAccountActionKind;
	ariaLabel?: string;
	children: ReactNode;
	className?: string;
	path: string;
}) {
	if (input.actionKind === "authorize") {
		return (
			<a
				aria-label={input.ariaLabel}
				className={input.className}
				href={input.path}
			>
				{input.children}
			</a>
		);
	}
	return (
		<Link
			aria-label={input.ariaLabel}
			className={input.className}
			to={input.path}
		>
			{input.children}
		</Link>
	);
}
