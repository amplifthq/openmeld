import type { SpaceScreenAction } from "./space-screen-actions";
import {
  createInitialSpaceScreenState,
  type SpaceScreenState,
} from "./space-screen-state";

type SpaceScreenListener = (state: SpaceScreenState) => void;

export type SpaceScreenStore = {
  getState(): SpaceScreenState;
  dispatch(action: SpaceScreenAction): void;
  subscribe(listener: SpaceScreenListener): () => void;
};

export function createSpaceScreenStore(
  initialState: SpaceScreenState = createInitialSpaceScreenState()
): SpaceScreenStore {
  let state = initialState;
  const listeners = new Set<SpaceScreenListener>();

  const notify = (): void => {
    for (const listener of listeners) {
      listener(state);
    }
  };

  return {
    getState() {
      return state;
    },
    dispatch(action) {
      const nextState = reduceSpaceScreenState(state, action);
      if (nextState === state) {
        return;
      }
      state = nextState;
      notify();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

function reduceSpaceScreenState(
  state: SpaceScreenState,
  action: SpaceScreenAction
): SpaceScreenState {
  switch (action.type) {
    case "connection.connected":
      if (state.connection.status === "connected") {
        return state;
      }
      return {
        ...state,
        connection: {
          ...state.connection,
          status: "connected",
        },
      };

    case "connection.closing":
      return {
        ...state,
        connection: {
          ...state.connection,
          status: "closing",
          closeReason: action.reason,
        },
      };

    case "connection.closed":
      return {
        ...state,
        connection: {
          ...state.connection,
          status: "closed",
          closeReason: action.reason,
          closeCode: action.code ?? null,
          closeSource: action.source,
        },
      };

    case "composer.buffer.updated":
      return {
        ...state,
        composer: {
          ...state.composer,
          bufferText: action.bufferText,
        },
      };

    case "transcript.item.appended":
      return {
        ...state,
        transcript: {
          ...state.transcript,
          items: [...state.transcript.items, action.item],
        },
      };

    case "status.overlay.updated":
      if (state.status.overlayLine === action.line) {
        return state;
      }
      return {
        ...state,
        status: {
          ...state.status,
          overlayLine: action.line,
        },
      };

    case "overlay.opened":
      if (
        state.overlay.kind === action.kind &&
        state.overlay.openedAtMs === action.openedAtMs
      ) {
        return state;
      }
      return {
        ...state,
        overlay: {
          kind: action.kind,
          openedAtMs: action.openedAtMs,
          interaction: state.overlay.interaction,
        },
      };

    case "overlay.closed":
      if (state.overlay.kind === "none") {
        return state;
      }
      return {
        ...state,
        overlay: {
          kind: "none",
          openedAtMs: null,
          interaction: {
            activeItemId: null,
            query: "",
          },
        },
      };

    case "overlay.interaction.reset":
      if (
        state.overlay.interaction.activeItemId === null &&
        state.overlay.interaction.query === ""
      ) {
        return state;
      }
      return {
        ...state,
        overlay: {
          ...state.overlay,
          interaction: {
            activeItemId: null,
            query: "",
          },
        },
      };

    case "overlay.query.updated":
      if (state.overlay.interaction.query === action.query) {
        return state;
      }
      return {
        ...state,
        overlay: {
          ...state.overlay,
          interaction: {
            ...state.overlay.interaction,
            query: action.query,
          },
        },
      };

    case "overlay.active-item.updated":
      if (state.overlay.interaction.activeItemId === action.activeItemId) {
        return state;
      }
      return {
        ...state,
        overlay: {
          ...state.overlay,
          interaction: {
            ...state.overlay.interaction,
            activeItemId: action.activeItemId,
          },
        },
      };

    case "members.updated":
      return {
        ...state,
        members: {
          refreshError: null,
          snapshot: action.snapshot,
          updatedAtMs: action.updatedAtMs,
        },
      };

    case "members.refresh.failed":
      if (state.members.refreshError === action.error) {
        return state;
      }
      return {
        ...state,
        members: {
          ...state.members,
          refreshError: action.error,
        },
      };

    default:
      return state;
  }
}
