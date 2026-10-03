export const LANDING_MOTION_EASE = [0.22, 1, 0.36, 1] as const;

export const LANDING_MOTION_SPRING = {
	damping: 24,
	mass: 0.8,
	stiffness: 180,
	type: "spring",
} as const;

export const LANDING_MOTION_CYCLE_SECONDS = 7;
