import type { CurrentCommandCheckState } from "./types";

const currentCommandCheckState: CurrentCommandCheckState = {
  signIn: null,
  selectedProfile: null,
};
let currentCommandCheckScopeDepth = 0;

export function resetCurrentCommandCheckState(): void {
  currentCommandCheckState.signIn = null;
  currentCommandCheckState.selectedProfile = null;
}

export function getCurrentCommandCheckState(): CurrentCommandCheckState {
  return currentCommandCheckState;
}

export function startCurrentCommandCheckScope(): void {
  if (currentCommandCheckScopeDepth === 0) {
    resetCurrentCommandCheckState();
  }
  currentCommandCheckScopeDepth += 1;
}

export function finishCurrentCommandCheckScope(): void {
  if (currentCommandCheckScopeDepth === 0) {
    resetCurrentCommandCheckState();
    return;
  }
  currentCommandCheckScopeDepth -= 1;
  if (currentCommandCheckScopeDepth === 0) {
    resetCurrentCommandCheckState();
  }
}

export function isCurrentCommandCheckScopeActive(): boolean {
  return currentCommandCheckScopeDepth > 0;
}
