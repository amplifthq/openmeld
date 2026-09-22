import { QueryClientContext } from "@tanstack/react-query";
import { useContext, useSyncExternalStore } from "react";
import { spaceFileImageResources } from "#/query/spaces/space-file-image-resource";

const noSource = () => null;
const noSubscription = () => () => {
	/* No managed image is mounted. */
};

/** Composer and focused viewers observe the same revocation as message images. */
export function useSpaceImagePreviewSource(source: string | null) {
	const client = useContext(QueryClientContext);
	const resource =
		client && source ? spaceFileImageResources(client).find(source) : undefined;
	const url = useSyncExternalStore(
		resource?.subscribe ?? noSubscription,
		resource?.getSnapshot ?? noSource,
		noSource
	);
	return {
		source: resource ? url : source,
		revoked: Boolean(resource && !url),
	};
}
