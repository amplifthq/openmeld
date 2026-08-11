"use client";

import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useStartFlowState } from "./start-flow-state";

export function useStartFlowGuard(input: {
	when: boolean;
	redirectTo: string;
}) {
	const navigate = useNavigate();
	const { hasRestored } = useStartFlowState();

	useEffect(() => {
		if (!hasRestored || input.when) {
			return;
		}

		navigate({ to: input.redirectTo, replace: true }).catch(
			(error: unknown) => {
				console.error("Failed to redirect the OpenMeld start flow.", error);
			}
		);
	}, [hasRestored, input.redirectTo, input.when, navigate]);

	return hasRestored && input.when;
}
