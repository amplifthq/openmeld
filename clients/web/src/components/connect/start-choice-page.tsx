import {
	Card,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@openmeld/ui/components/card";
import { cn } from "@openmeld/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useSelectedHumanProfile } from "#/lib/profiles/use-selected-human-profile";

export type StartChoiceCardItem = {
	description: string;
	id: string;
	onSelect?: () => void;
	title: string;
	to?: string;
};

export function StartChoicePage(input: {
	title: string;
	description: string;
	cards?: readonly StartChoiceCardItem[];
	children?: ReactNode;
	backControl?: ReactNode;
	backTo?: string;
	backLabel?: string;
	headerAside?: ReactNode;
	hideSelectedProfileGreeting?: boolean;
}) {
	const { selectedHumanProfile } = useSelectedHumanProfile();
	const visibleTitle =
		input.hideSelectedProfileGreeting || !selectedHumanProfile
			? input.title
			: `Hello, ${selectedHumanProfile.profileName}. ${input.title}`;
	const backControl =
		input.backControl ??
		(input.backTo ? (
			<Link
				className="w-fit text-muted-foreground text-sm transition-colors hover:text-foreground"
				to={input.backTo}
			>
				{input.backLabel ?? "back"}
			</Link>
		) : null);

	return (
		<section className="flex min-h-[calc(100svh-10rem)] flex-col">
			<div className="flex flex-1 flex-col justify-center gap-14">
				<header className="w-full">
					<div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
						<div className="flex min-w-0 flex-col gap-3">
							{backControl}
							<h1 className="max-w-2xl font-medium text-foreground text-lg sm:text-xl">
								{visibleTitle}
							</h1>
							<p className="max-w-2xl text-muted-foreground text-sm">
								{input.description}
							</p>
						</div>
						{input.headerAside ? (
							<div className="w-full sm:w-auto">{input.headerAside}</div>
						) : null}
					</div>
				</header>
				<div className="grid w-full gap-4 md:grid-cols-2">
					{input.children ??
						input.cards?.map((card) => (
							<StartChoiceCard key={card.id} {...card} />
						))}
				</div>
			</div>
		</section>
	);
}

function StartChoiceCard(input: StartChoiceCardItem) {
	const cardContent = <StartChoiceCardSurface {...input} />;

	if (input.to) {
		return (
			<Link
				className="w-full text-left focus-visible:ring-1 focus-visible:ring-ring/50"
				onClick={input.onSelect}
				to={input.to}
			>
				{cardContent}
			</Link>
		);
	}

	return (
		<button
			className="w-full text-left focus-visible:ring-1 focus-visible:ring-ring/50"
			data-choice={input.id}
			onClick={input.onSelect}
			type="button"
		>
			{cardContent}
		</button>
	);
}

export function StartChoiceCardSurface(input: {
	title: string;
	description: string;
	className?: string;
	action?: ReactNode;
}) {
	return (
		<Card
			className={cn(
				"relative h-full min-h-44 w-full justify-center gap-0 py-0 transition-colors hover:bg-muted/20",
				input.className
			)}
		>
			{input.action ? (
				<div className="absolute top-4 right-4 z-10">{input.action}</div>
			) : null}
			<CardHeader className="gap-3 text-left">
				<div className="w-full min-w-0 space-y-2 text-left">
					<CardTitle className="text-balance text-left text-foreground text-lg">
						{input.title}
					</CardTitle>
					<CardDescription className="w-full text-pretty text-left text-muted-foreground text-sm">
						{input.description}
					</CardDescription>
				</div>
			</CardHeader>
		</Card>
	);
}
