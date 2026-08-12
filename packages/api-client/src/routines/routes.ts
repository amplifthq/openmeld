const ROUTINES_PATH = "/v1/organizations/current/routines";
const ROUTINE_TARGET_SPACES_PATH =
  "/v1/organizations/current/routine-target-spaces";

type RoutineContractQuery = { contract?: "practical-v2" };
type RoutineListContractQuery = {
  contract?: "management-v1" | "management-v2" | "practical-v2";
};

export function buildRoutinesPath(
  query: RoutineListContractQuery = {}
): string {
  return appendRoutineContract(ROUTINES_PATH, query);
}

export function buildRoutineTargetSpacesPath(): string {
  return ROUTINE_TARGET_SPACES_PATH;
}

export function buildRoutinePath(
  routineId: string,
  query: RoutineContractQuery = {}
): string {
  return appendRoutineContract(
    `${ROUTINES_PATH}/${encodeURIComponent(routineId)}`,
    query
  );
}

export function buildRoutinePausePath(
  routineId: string,
  query: RoutineContractQuery = {}
): string {
  return appendRoutineContract(
    `${ROUTINES_PATH}/${encodeURIComponent(routineId)}/pause`,
    query
  );
}

export function buildRoutineResumePath(
  routineId: string,
  query: RoutineContractQuery = {}
): string {
  return appendRoutineContract(
    `${ROUTINES_PATH}/${encodeURIComponent(routineId)}/resume`,
    query
  );
}

export function buildRoutineRunsPath(
  routineId: string,
  query: {
    beforeScheduledFor?: number;
    contract?: "practical-v2";
    limit?: number;
  } = {}
): string {
  const search = new URLSearchParams();
  if (query.beforeScheduledFor !== undefined) {
    search.set("beforeScheduledFor", String(query.beforeScheduledFor));
  }
  if (query.limit !== undefined) {
    search.set("limit", String(query.limit));
  }
  if (query.contract !== undefined) {
    search.set("contract", query.contract);
  }
  const encodedQuery = search.toString();
  const path = `${buildRoutinePath(routineId)}/runs`;
  return encodedQuery.length > 0 ? `${path}?${encodedQuery}` : path;
}

function appendRoutineContract(
  path: string,
  query: RoutineListContractQuery
): string {
  return query.contract ? `${path}?contract=${query.contract}` : path;
}
