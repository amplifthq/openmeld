import type {
	GetOrganizationDocumentResponse,
	ListOrganizationDocumentsResponse,
} from "@openmeld/schemas/types";
import { queryOptions } from "@tanstack/react-query";
import {
	getCurrentOrganizationDocument,
	listCurrentOrganizationDocuments,
	type OrganizationDocumentFailure,
} from "#/lib/organizations/organization-documents";
import { baseQueryOptions } from "#/query/query-config";

export const organizationDocumentQueryKeys = {
	all: ["organization-documents"] as const,
	list: (organizationId: string) =>
		[...organizationDocumentQueryKeys.all, organizationId, "list"] as const,
	detail: (organizationId: string, documentId: string) =>
		[
			...organizationDocumentQueryKeys.all,
			organizationId,
			"detail",
			documentId,
		] as const,
};

export function organizationDocumentsQueryOptions(input: {
	enabled?: boolean;
	organizationId: string;
}) {
	return queryOptions<
		ListOrganizationDocumentsResponse,
		OrganizationDocumentFailure
	>({
		enabled: input.enabled ?? true,
		gcTime: baseQueryOptions.gcTime,
		queryFn: async ({ signal }) =>
			await listCurrentOrganizationDocuments({
				organizationId: input.organizationId,
				signal,
			}),
		queryKey: organizationDocumentQueryKeys.list(input.organizationId),
		refetchOnWindowFocus: false,
		retry: baseQueryOptions.retry,
		staleTime: 10_000,
	});
}

export function organizationDocumentQueryOptions(input: {
	documentId: string;
	enabled?: boolean;
	organizationId: string;
}) {
	return queryOptions<
		GetOrganizationDocumentResponse,
		OrganizationDocumentFailure
	>({
		enabled: input.enabled ?? true,
		gcTime: baseQueryOptions.gcTime,
		queryFn: async ({ signal }) =>
			await getCurrentOrganizationDocument({
				documentId: input.documentId,
				organizationId: input.organizationId,
				signal,
			}),
		queryKey: organizationDocumentQueryKeys.detail(
			input.organizationId,
			input.documentId
		),
		refetchOnWindowFocus: false,
		retry: baseQueryOptions.retry,
		staleTime: 10_000,
	});
}
