---
id: typescript-native-compiler
title: Use the native TypeScript compiler for development checks
kind: improved
areas: ["development"]
audiences: ["contributors"]
---

Workspace type checks and TypeScript builds use TypeScript 7. Legacy compiler
API tools continue to use Microsoft's TypeScript 6 compatibility package.
Contributors can check the active compiler with `pnpm exec tsc --version`.
