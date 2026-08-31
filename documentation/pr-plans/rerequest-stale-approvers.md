# Re-request reviewers whose approval no longer counts

## Goal

A PR that is up for review always has the reviewers it is waiting on mapped as Asana approval subtasks — an approval that went stale behind a later changes-request, or was dismissed, summons its reviewer back instead of silently deadlocking the tier cascade.

## Definition of Done

- [ ] When a submitted approval's cascade finds a review-tier reviewer whose latest verdict is a stale approval or a dismissal and who is not already a requested reviewer, the action re-requests their review on GitHub, so the existing `review_requested` path re-creates their "Review" subtask and moves the task back to Testing / Review.
- [ ] Bots and unmapped users are never re-requested, and reviewers already pending are not re-requested again.
- [ ] A failed re-request call is logged and does not abort the cascade or the rest of the sync.
- [ ] Jest covers the deadlock shape (an approval arriving after a changes-request re-requests the stale approver and creates no next-tier subtasks) and the never-re-requested cases (already pending, bot, dismissed-vs-fresh).
- [ ] `dist/` matches a fresh build of the changed source.
- [ ] The sync-contract table in the README names the resummon rule.
