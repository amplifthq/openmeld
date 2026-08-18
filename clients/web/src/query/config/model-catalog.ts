import {
	createConfigApi,
	type StructuredApiClientFailure,
} from "@openmeld/api-client";
import type { GetModelCatalogResponse } from "@openmeld/schemas/types";
import { queryOptions } from "@tanstack/react-query";
import { createUnscopedWebOpenMeldApiFoundation } from "#/lib/openmeld-api/client";
import { baseQueryOptions } from "#/query/query-config";
import { configQueryKeys } from "#/query/query-keys";

export async function readWebModelCatalog(): Promise<GetModelCatalogResponse> {
	return await createConfigApi(
		createUnscopedWebOpenMeldApiFoundation()
	).getModelCatalog();
}

export function modelCatalogQueryOptions() {
	return queryOptions<GetModelCatalogResponse, StructuredApiClientFailure>({
		queryKey: configQueryKeys.modelCatalog,
		queryFn: readWebModelCatalog,
		gcTime: baseQueryOptions.gcTime,
		retry: baseQueryOptions.retry,
		staleTime: 5 * 60 * 1000,
		refetchOnMount: false,
		refetchOnWindowFocus: false,
	});
}
