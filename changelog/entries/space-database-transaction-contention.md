---
id: space-database-transaction-contention
title: Keep background Space updates from blocking message publication
kind: fixed
areas: ["spaces", "inbox"]
audiences: ["users", "operators"]
---

Fixed a circular wait between background Space database transactions and
concurrent message publication when database connections are constrained.
Transactions now complete within the Space's protected execution boundary
without holding the whole background task inside it. Recoverable background
errors continue to reach their existing handlers.
