import { createContext } from "react";

// Full pages track reads by default. Embedded previews only track the window
// the person is interacting with; simply showing a gallery must not mark read.
export const SpaceReadTrackingContext = createContext(true);
