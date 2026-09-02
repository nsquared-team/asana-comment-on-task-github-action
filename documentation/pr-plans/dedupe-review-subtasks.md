# One "Review" subtask per reviewer, even when workflow runs overlap

## Goal

A reviewer gets exactly one pending "Review" subtask on an Asana task, so nobody sees two approvals to give for one PR.

## Definition of Done

- [x] When two sync runs for one PR both create a "Review" subtask for the same reviewer (ready_for_review and review_requested landing in the same second), only the older one survives; both runs converge on the same survivor.
- [x] A single run that creates a subtask with no rival deletes nothing.
- [x] Jest covers the overlap shape and fails if the dedupe is removed.
- [x] `dist/` matches a fresh build of the changed source.
- [x] The README's review-requested row states the rule.
