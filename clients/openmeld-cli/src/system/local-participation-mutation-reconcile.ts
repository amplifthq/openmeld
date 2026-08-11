import { maybeAutoStopIdleLocalService } from "../local-service/lifecycle/local-service-demand";
import type { Presenter } from "../runtime/presenter/types";

export async function postLocalParticipationMutationReconcile(input: {
  codePrefix: string;
  ownerUserId?: string | null;
  presenter: Presenter;
  shouldReconcile: boolean;
  runtimeWorkdir?: string;
}): Promise<void> {
  if (!input.shouldReconcile) {
    return;
  }

  await maybeAutoStopIdleLocalService({
    codePrefix: input.codePrefix,
    ownerUserId: input.ownerUserId,
    presenter: input.presenter,
    runtimeWorkdir: input.runtimeWorkdir,
  });
}
