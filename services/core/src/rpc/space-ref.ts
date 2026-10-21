import {
  isHexSpaceId as isHexSpaceIdShared,
  normalizeHexSpaceId,
} from "../shared/ids/space-id";
import type { Space } from "../space/transport/do/space";

export function isHexSpaceId(spaceId: string): boolean {
  return isHexSpaceIdShared(spaceId);
}

export function resolveNewSpaceId(
  namespace: DurableObjectNamespace<Space>,
  _name?: string
): DurableObjectId {
  return namespace.newUniqueId();
}

export function resolveNamedSpaceId(
  namespace: DurableObjectNamespace<Space>,
  name: string
): DurableObjectId {
  return namespace.idFromName(name);
}

// Space objects read PostgreSQL and call Auth on most requests, and both run
// in us-east-1 next to the Gateway's placement. A hint only places an object
// when it is first created; existing Spaces keep their current location.
const SPACE_OBJECT_LOCATION_HINT: DurableObjectLocationHint = "enam";

export function getSpaceStubById(
  namespace: DurableObjectNamespace<Space>,
  id: DurableObjectId
): DurableObjectStub<Space> {
  return namespace.get(id, { locationHint: SPACE_OBJECT_LOCATION_HINT });
}

export function resolveSpaceStub(
  namespace: DurableObjectNamespace<Space>,
  spaceId: string
): DurableObjectStub<Space> | null {
  const normalizedSpaceId = normalizeHexSpaceId(spaceId);
  if (!normalizedSpaceId) {
    return null;
  }

  try {
    const id = namespace.idFromString(normalizedSpaceId);
    return getSpaceStubById(namespace, id);
  } catch {
    return null;
  }
}
