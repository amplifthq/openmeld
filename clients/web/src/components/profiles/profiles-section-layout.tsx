"use client";

import type { ReactNode } from "react";

export function ProfilesSectionLayout(input: {
	action?: ReactNode;
	children: ReactNode;
	description: string;
	headingLevel?: "h1" | "h2";
	title: string;
}) {
	const Heading = input.headingLevel === "h2" ? "h2" : "h1";
	return (
		<section className="flex min-w-0 flex-col gap-5">
			<header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
				<div className="min-w-0 space-y-1">
					<Heading className="font-medium text-base text-foreground">
						{input.title}
					</Heading>
					<p className="max-w-3xl text-muted-foreground text-xs leading-5">
						{input.description}
					</p>
				</div>
				{input.action ? (
					<div className="flex w-full shrink-0 items-start sm:w-auto sm:justify-end">
						{input.action}
					</div>
				) : null}
			</header>
			<div className="flex min-w-0 flex-col gap-3">{input.children}</div>
		</section>
	);
}
