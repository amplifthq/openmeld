"use client";

import { useReducedMotion } from "motion/react";
import {
	type OrganizationIdentity,
	OrganizationIdentityMark,
} from "#/components/organizations/organization-identity-mark";

export type OrganizationOnboardingPreview = OrganizationIdentity & {
	id: string;
	isPersonal: boolean;
};

export type OrganizationOnboardingPerson = {
	id: string;
	image: string | null;
	name: string;
};

const PERSON_X = 52;
const PERSON_WIDTH = 136;
const PERSON_HEIGHT = 48;
const PERSON_Y_BY_COUNT = {
	1: [250],
	2: [174, 326],
	3: [98, 250, 402],
} as const;
const TARGET_Y_BY_COUNT = {
	1: [256],
	2: [234, 278],
	3: [212, 256, 300],
} as const;
const WHITESPACE_PATTERN = /\s+/u;

export function OrganizationOnboardingDemo(input: {
	organization: OrganizationOnboardingPreview;
	people: readonly OrganizationOnboardingPerson[];
}) {
	const shouldReduceMotion = useReducedMotion() === true;
	const visiblePeople = input.people
		.filter((person) => resolveFirstName(person.name) !== "")
		.slice(0, input.organization.isPersonal ? 1 : 3);
	const personYPositions =
		PERSON_Y_BY_COUNT[visiblePeople.length as keyof typeof PERSON_Y_BY_COUNT] ??
		[];
	const targetYPositions =
		TARGET_Y_BY_COUNT[visiblePeople.length as keyof typeof TARGET_Y_BY_COUNT] ??
		[];
	const organizationName = input.organization.isPersonal
		? "Personal Workspace"
		: input.organization.name || "Your organization";

	return (
		<div className="relative aspect-square w-full max-w-[38rem] text-white">
			<svg
				aria-hidden="true"
				className="absolute inset-0 size-full overflow-visible"
				fill="none"
				viewBox="0 0 600 600"
			>
				<defs>
					<linearGradient id="organization-line" x1="0" x2="1">
						<stop offset="0" stopColor="rgba(255,255,255,0.08)" />
						<stop offset="0.55" stopColor="rgba(255,255,255,0.42)" />
						<stop offset="1" stopColor="rgba(255,255,255,0.08)" />
					</linearGradient>
					<filter
						height="220%"
						id="organization-glow"
						width="220%"
						x="-60%"
						y="-60%"
					>
						<feGaussianBlur stdDeviation="6" />
					</filter>
				</defs>

				{visiblePeople.map((person, index) => {
					const personY =
						personYPositions[index] ?? PERSON_Y_BY_COUNT[3][index];
					if (personY === undefined) {
						return null;
					}
					const targetY =
						targetYPositions[index] ?? TARGET_Y_BY_COUNT[3][index];
					if (targetY === undefined) {
						return null;
					}
					const lineStartX = PERSON_X + PERSON_WIDTH;
					const lineStartY = personY + PERSON_HEIGHT / 2;
					return (
						<g key={person.id}>
							<path
								d={`M ${lineStartX} ${lineStartY} C 218 ${lineStartY}, 218 ${targetY}, 270 ${targetY}`}
								stroke="rgba(255,255,255,0.13)"
								strokeWidth="1"
							/>
							{shouldReduceMotion ? null : (
								<circle
									cx={lineStartX}
									cy={lineStartY}
									fill="rgba(255,255,255,0.7)"
									r="2.5"
								>
									<animate
										attributeName="opacity"
										begin={`${index * -0.9}s`}
										dur="2.7s"
										repeatCount="indefinite"
										values="0;1;0"
									/>
									<animateMotion
										begin={`${index * -0.9}s`}
										dur="2.7s"
										path={`M 0 0 C ${218 - lineStartX} 0, ${218 - lineStartX} ${targetY - lineStartY}, ${270 - lineStartX} ${targetY - lineStartY}`}
										repeatCount="indefinite"
									/>
								</circle>
							)}
						</g>
					);
				})}

				<circle
					cx="360"
					cy="256"
					fill="rgba(255,255,255,0.08)"
					filter="url(#organization-glow)"
					r="72"
				/>
				<rect
					fill="rgba(12,13,15,0.96)"
					height="168"
					stroke="rgba(255,255,255,0.26)"
					width="180"
					x="270"
					y="172"
				/>
			</svg>

			{visiblePeople.map((person, index) => (
				<div
					className="absolute flex h-12 w-[22.6667%] items-center gap-2.5 rounded-md border border-white/15 bg-white/[0.055] px-2.5 text-white/72 shadow-[0_12px_32px_rgba(0,0,0,0.32)]"
					key={person.id}
					style={{
						left: `${(PERSON_X / 600) * 100}%`,
						top: `${((personYPositions[index] ?? PERSON_Y_BY_COUNT[3][index] ?? 250) / 600) * 100}%`,
					}}
				>
					<span className="grid size-7 shrink-0 place-items-center overflow-hidden rounded-md border border-white/12 bg-white/[0.045] text-[10px] text-white/62">
						{person.image ? (
							<img
								alt=""
								className="size-full object-cover"
								height={40}
								src={person.image}
								width={40}
							/>
						) : (
							resolveFirstName(person.name).charAt(0).toUpperCase()
						)}
					</span>
					<span className="truncate font-medium text-[11px]">
						{resolveFirstName(person.name)}
					</span>
				</div>
			))}

			<div className="absolute top-[28.6667%] left-[45%] flex h-[28%] w-[30%] flex-col items-center justify-center text-center">
				<OrganizationIdentityMark
					className="mb-4 size-11 rounded-md border border-white/20 bg-white/[0.07] text-[11px] text-white/85"
					organization={input.organization}
				/>
				<p className="line-clamp-2 max-w-[9.5rem] text-balance font-medium text-sm text-white/92 leading-5">
					{organizationName}
				</p>
				<p className="mt-1.5 text-[10px] text-white/48">
					{input.organization.isPersonal
						? "Private to you"
						: "Shared with your team"}
				</p>
			</div>
		</div>
	);
}

function resolveFirstName(name: string): string {
	return name.trim().split(WHITESPACE_PATTERN)[0] ?? "";
}
