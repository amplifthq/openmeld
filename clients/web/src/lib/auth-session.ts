import { createServerFn } from "@tanstack/react-start";
import { z } from "zod/v4";
import { getRequiredServerEnv } from "#/env";
import type {
	SessionCacheMode,
	CurrentUserSessionExpectation as SessionExpectation,
} from "./dev-ssr-fetch-diagnostics";

const getSessionInputSchema = z
	.strictObject({
		routeFamily: z.string().trim().min(1),
		currentUserSessionExpectation: z.enum(["optional", "required"]),
		sessionCacheMode: z.enum(["allow", "bypass"]).optional(),
	})
	.optional();

type GetSessionInput =
	| {
			routeFamily: string;
			currentUserSessionExpectation: SessionExpectation;
			sessionCacheMode?: SessionCacheMode;
	  }
	| undefined;

function loadServerSessionHelper() {
	return import("./auth-session.server");
}

export const getSession = createServerFn({ method: "GET" })
	.validator((data: unknown): GetSessionInput => {
		const parsed = getSessionInputSchema.safeParse(data);
		if (!parsed.success) {
			throw new Error(
				parsed.error.issues[0]?.message ?? "Invalid getSession input."
			);
		}

		return parsed.data;
	})
	.handler(async ({ data }) => {
		const { fetchSessionFromGateway } = await loadServerSessionHelper();
		const result = await fetchSessionFromGateway({
			betterAuthUrl: getRequiredServerEnv("BETTER_AUTH_URL"),
			currentUserSessionExpectation:
				data?.currentUserSessionExpectation ?? "optional",
			routeFamily: data?.routeFamily ?? "unknown_route",
			sessionCacheMode: data?.sessionCacheMode,
		});
		if (!result) {
			return null;
		}
		// Browser/desktop consumers need identity, never a transferable credential.
		const { token: _token, ...session } = result.session;
		return { ...result, session };
	});

export const ensureSession = createServerFn({ method: "GET" }).handler(
	async () => {
		const session = await getSession({
			data: {
				currentUserSessionExpectation: "required",
				routeFamily: "ensure-session",
			},
		});
		if (!session) {
			throw new Error("Unauthorized");
		}

		return session;
	}
);

export type {
	CurrentUserSessionExpectation,
	SessionCacheMode,
} from "./dev-ssr-fetch-diagnostics";
