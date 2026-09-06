---
id: sidebar-sort-consistency
title: Keep sidebar sorting consistent with conversation activity
kind: fixed
areas: ["web"]
audiences: ["users"]
---

Recent activity sorts Spaces and Direct Messages by conversation time, using
creation time for empty conversations. New ordinary sections default to this
order. Sidebars wait for saved groups and initial conversation times before
showing rows, avoiding temporary regrouping and partial-data reordering.
