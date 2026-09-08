"use client";

import { surfaceClasses } from "@openmeld/ui/lib/surface-classes";
import { SurfaceProvider, useSurface } from "@openmeld/ui/lib/surface-context";
import { cn } from "@openmeld/ui/lib/utils";
import {
	type ComponentPropsWithoutRef,
	forwardRef,
	type ReactNode,
} from "react";

type ElevatedProps = ComponentPropsWithoutRef<"div"> & {
	offset: number;
	shadowLevel?: number;
	children?: ReactNode;
};

const Elevated = forwardRef<HTMLDivElement, ElevatedProps>(
	({ offset, shadowLevel, className, children, ...props }, ref) => {
		const substrate = useSurface();
		const level = Math.min(substrate + offset, 8);

		return (
			<SurfaceProvider value={level}>
				<div
					className={cn(surfaceClasses(level, shadowLevel ?? level), className)}
					ref={ref}
					{...props}
				>
					{children}
				</div>
			</SurfaceProvider>
		);
	}
);

Elevated.displayName = "Elevated";

export { Elevated };
