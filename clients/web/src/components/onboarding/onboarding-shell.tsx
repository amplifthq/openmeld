"use client";

import { Button } from "@openmeld/ui/components/button";
import { ArrowLeftIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { OpenMeldLogo } from "#/components/openmeld-logo-weak";
import type { OpenMeldOnboardingStep } from "#/lib/onboarding/onboarding-progress";

export function OnboardingShell(input: {
	children: ReactNode;
	demo: ReactNode;
	description: string;
	eyebrow: string;
	onBack?: () => void;
	onSkip?: () => void;
	step: OpenMeldOnboardingStep;
	steps: readonly OpenMeldOnboardingStep[];
	title: string;
}) {
	const visibleProgressSteps = input.steps.filter(
		(step) => step !== "complete"
	);
	const stepIndex = visibleProgressSteps.indexOf(
		input.step === "complete" ? "invite" : input.step
	);
	const resolvedStepIndex =
		input.step === "complete" ? visibleProgressSteps.length - 1 : stepIndex;
	return (
		<div className="relative grid h-full min-h-0 w-full overflow-hidden bg-background text-foreground lg:grid-cols-[minmax(0,1.02fr)_minmax(30rem,0.98fr)]">
			<section className="relative flex min-h-0 min-w-0 flex-col overflow-hidden border-border/70 border-r">
				<header className="flex h-20 shrink-0 items-center justify-between px-5 sm:px-8 lg:px-10 [@media(max-height:640px)]:h-14">
					<OpenMeldLogo
						ariaLabel="OpenMeld"
						className="text-foreground"
						pointerTracking="element"
						scale={0.15}
					/>
					{input.onSkip ? (
						<Button
							className="rounded-md px-4 text-muted-foreground hover:text-foreground"
							onClick={input.onSkip}
							size="sm"
							type="button"
							variant="ghost"
						>
							Skip setup
						</Button>
					) : null}
				</header>

				<div className="mx-auto flex min-h-0 w-full max-w-[43rem] flex-1 flex-col px-6 pt-8 pb-8 sm:px-10 lg:px-14 lg:pt-10 lg:pb-10 [@media(max-height:640px)]:pt-2 [@media(max-height:640px)]:pb-3">
					<div
						aria-label={`Step ${Math.max(resolvedStepIndex + 1, 1)} of ${visibleProgressSteps.length}`}
						aria-valuemax={visibleProgressSteps.length}
						aria-valuemin={1}
						aria-valuenow={Math.max(resolvedStepIndex + 1, 1)}
						className="mb-8 grid shrink-0 gap-1.5 [@media(max-height:640px)]:mb-4"
						role="progressbar"
						style={{
							gridTemplateColumns: `repeat(${visibleProgressSteps.length}, minmax(0, 1fr))`,
						}}
					>
						{visibleProgressSteps.map((step, index) => (
							<span
								className={`h-0.5 rounded-md transition-colors duration-300 ${
									index <= resolvedStepIndex ? "bg-foreground" : "bg-border"
								}`}
								key={step}
							/>
						))}
					</div>

					<div className="mb-7 shrink-0 [@media(max-height:640px)]:mb-4">
						<div className="mb-4 flex h-5 items-center gap-3">
							{input.onBack ? (
								<button
									aria-label="Go back"
									className="-ml-2 grid size-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
									onClick={input.onBack}
									type="button"
								>
									<ArrowLeftIcon aria-hidden="true" className="size-4" />
								</button>
							) : null}
							<p className="font-medium text-muted-foreground text-xs uppercase tracking-[0.16em]">
								{input.eyebrow}
							</p>
						</div>
						<h1 className="max-w-xl text-balance font-medium text-3xl leading-[1.12] tracking-[-0.035em] sm:text-4xl [@media(max-height:640px)]:text-2xl">
							{input.title}
						</h1>
						<p className="mt-4 max-w-xl text-pretty text-base text-muted-foreground leading-7 [@media(max-height:640px)]:mt-2 [@media(max-height:640px)]:text-sm [@media(max-height:640px)]:leading-5">
							{input.description}
						</p>
					</div>

					<div className="flex min-h-0 min-w-0 flex-1 flex-col">
						{input.children}
					</div>
				</div>
			</section>

			<aside
				aria-label="OpenMeld setup preview"
				className="relative hidden min-h-0 overflow-hidden bg-[#0b0c0e] lg:block"
			>
				<div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_34%,rgba(255,255,255,0.075),transparent_42%)]" />
				<div className="relative flex h-full items-center justify-center p-10 xl:p-16">
					{input.demo}
				</div>
			</aside>
		</div>
	);
}
