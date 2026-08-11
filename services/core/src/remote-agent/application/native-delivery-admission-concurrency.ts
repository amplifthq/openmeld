export async function prepareRemoteAgentAdmissionFoundation<T>(input: {
  persistAdmissionIntent: () => Promise<unknown>;
  readDesignation: () => Promise<T>;
}): Promise<T> {
  const admissionIntentPromise = input.persistAdmissionIntent();
  const designationPromise = input.readDesignation();
  const [, designation] = await Promise.all([
    admissionIntentPromise,
    designationPromise,
  ]);
  return designation;
}

export function startRemoteAgentTurnContextAndSkills<
  TTurnContext,
  TOrganizationSkills,
>(input: {
  readOrganizationSkills: () => Promise<TOrganizationSkills>;
  resolveTurnContext: () => Promise<TTurnContext>;
}): {
  organizationSkills: Promise<PromiseSettledResult<TOrganizationSkills>>;
  turnContext: Promise<PromiseSettledResult<TTurnContext>>;
} {
  const turnContext = settleRemoteAgentPreparation(input.resolveTurnContext);
  const organizationSkills = settleRemoteAgentPreparation(
    input.readOrganizationSkills
  );
  return {
    organizationSkills,
    turnContext,
  };
}

async function settleRemoteAgentPreparation<T>(
  read: () => Promise<T>
): Promise<PromiseSettledResult<T>> {
  try {
    return {
      status: "fulfilled",
      value: await read(),
    };
  } catch (reason) {
    return {
      reason,
      status: "rejected",
    };
  }
}

export function runRemoteAgentAdmissionWithWatchdog<T>(input: {
  enqueueWatchdog: () => Promise<unknown>;
  submitAdmission: () => Promise<T>;
}): {
  admission: Promise<T>;
  watchdog: Promise<PromiseSettledResult<unknown>>;
} {
  const watchdog = settleRemoteAgentPreparation(input.enqueueWatchdog);
  let admission: Promise<T>;
  try {
    admission = input.submitAdmission();
  } catch (error) {
    admission = Promise.reject(error);
  }
  return { admission, watchdog };
}
