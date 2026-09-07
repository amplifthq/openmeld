---
id: preserve-local-settings-during-maintenance
title: Keep local settings safe during maintenance
kind: fixed
areas: ["cli", "openmeld-service"]
audiences: ["users"]
---

Changing OpenMeld's update settings preserves unrelated local configuration.
Damaged Skills records no longer prevent OpenMeld from reading your automatic
update preference. Older versions now preserve configuration and layout files
they cannot safely update instead of overwriting them.
