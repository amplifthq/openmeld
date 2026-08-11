/// <reference types="node" />

import { defineConfig } from "drizzle-kit";
import { resolveSharedDrizzleConfigInput } from "./src/shared/tooling-facts.ts";

export default defineConfig(resolveSharedDrizzleConfigInput());
