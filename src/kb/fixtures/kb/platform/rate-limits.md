---
id: kb.platform.rate-limits
namespace: platform
title: Rate Limits
owner: solutions-architect
status: active
review_by: "2027-06-30"
sensitivity: internal
source: authored
tags:
  - "429"
  - throttling
supersedes: []
---

## Defaults

Every API key starts at 60 requests per minute.

## Handling 429s

### Backoff

Retry with exponential backoff and jitter.

### Escalation

Contact the platform team for a limit increase.
