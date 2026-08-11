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
    return namespace.get(id);
  } catch {
    return null;
  }
}
