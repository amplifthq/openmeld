import type { AdapterInteractionCallback } from "@openmeld/adapter-core";

export function createSerialAgentInteractionCallback(
  requestInteraction: AdapterInteractionCallback
): AdapterInteractionCallback {
  let queueTail = Promise.resolve();

  return (request) => {
    const response = queueTail.then(() => requestInteraction(request));
    queueTail = response.then(
      () => undefined,
      () => undefined
    );
    return response;
  };
}
