import type {
  CenterAgentMemoryDetailedReader,
  CenterAgentMemoryDetailedSearchItem,
  CenterAgentMemoryReadRepository,
} from "./contract";
import { CENTER_AGENT_MEMORY_RECALL_TIMEOUT_MS } from "./contract";
import { withCenterAgentMemoryTimeout } from "./memory-service";

export type RetainedMemoryRead = {
  items: CenterAgentMemoryDetailedSearchItem[];
  status: "complete" | "partial" | "unavailable";
};

/** Existing retained subjects only; this path never invokes ensure/upsert/write. */
export async function searchRetainedCenterAgentMemory(input: {
  adapter: CenterAgentMemoryDetailedReader;
  repository: CenterAgentMemoryReadRepository;
  organizationId: string;
  speakerMember: { memberId: string; userId: string };
  query: string;
  limit: number;
}): Promise<RetainedMemoryRead> {
  try {
    const refs = await input.repository.readActiveSubjects(input);
    const results = await Promise.allSettled(
      refs.map((ref) =>
        withCenterAgentMemoryTimeout(
          input.adapter.searchDetailed({
            ref,
            query: input.query,
            limit: input.limit,
          }),
          CENTER_AGENT_MEMORY_RECALL_TIMEOUT_MS,
          "center_agent.memory_search_timeout"
        )
      )
    );
    // A provider read must not outlive deletion, policy opt-out, or a
    // replacement of the retained subject. Reuse the repository's authority.
    const currentRefs = await input.repository.readActiveSubjects(input);
    const successful = results.flatMap((result, index) => {
      const ref = refs[index];
      const stillCurrent = currentRefs.some(
        (current) =>
          current.subjectId === ref?.subjectId &&
          current.updatedAtMs === ref.updatedAtMs
      );
      return result.status === "fulfilled" && stillCurrent
        ? [result.value]
        : [];
    });
    const incomplete =
      successful.length !== results.length ||
      successful.some((result) => result.status === "partial");
    const items: CenterAgentMemoryDetailedSearchItem[] = [];
    // Preserve provider rank within each scope without letting the first scope
    // consume the entire candidate window. This is not exhaustive history.
    for (let rank = 0; rank < input.limit; rank += 1) {
      for (const result of successful) {
        const item = result.items[rank];
        if (item) {
          items.push(item);
        }
      }
    }
    let status: RetainedMemoryRead["status"] = incomplete
      ? "partial"
      : "complete";
    if (results.length > 0 && successful.length === 0) {
      status = "unavailable";
    }
    return { items, status };
  } catch (error) {
    console.warn("[core.center_agent_memory.search_unavailable]", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return { items: [], status: "unavailable" };
  }
}
