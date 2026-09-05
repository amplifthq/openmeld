import { WEB_APPLICATION_ERROR_PATH } from "@openmeld/schemas";
import { isNotFound, isRedirect } from "@tanstack/react-router";
import {
	createCsrfMiddleware,
	createMiddleware,
	createStart,
} from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { reportServerApplicationError } from "./lib/observability/application-error-server";

const requestErrors = createMiddleware().server(async ({ request, next }) => {
	try {
		const result = await next();
		if (
			result.response.status >= 500 &&
			new URL(request.url).pathname !== WEB_APPLICATION_ERROR_PATH
		) {
			reportServerApplicationError(
				null,
				request,
				"server_request",
				result.response.status
			);
		}
		return result;
	} catch (error) {
		if (
			!(isRedirect(error) || isNotFound(error) || error instanceof Response)
		) {
			reportServerApplicationError(error, request, "server_request");
		}
		throw error;
	}
});

const functionErrors = createMiddleware({ type: "function" }).server(
	async ({ next }) => {
		try {
			return await next();
		} catch (error) {
			if (
				!(isRedirect(error) || isNotFound(error) || error instanceof Response)
			) {
				reportServerApplicationError(error, getRequest(), "server_function");
			}
			throw error;
		}
	}
);

export const startInstance = createStart(() => ({
	// A custom Start instance must explicitly retain the default CSRF protection.
	requestMiddleware: [
		requestErrors,
		createCsrfMiddleware({ filter: (ctx) => ctx.handlerType === "serverFn" }),
	],
	functionMiddleware: [functionErrors],
}));
