## Goal

A reviewer who just approved is never asked again by the sync itself: only a real GitHub re-request — a person, or the dismissal path — creates a second "Review" subtask for them.

## Definition of Done

- [x] On the run for a reviewer's own approval, the cascade hands that reviewer no new Review subtask, even when GitHub's payload still lists them as requested and another reviewer in their tier is pending.
- [x] On that same run, the reconcile hands them none either, even when the fresh PR read still lists them as requested.
- [x] An approver the author really did ask again is still waited on: the task stays in review and their Review subtask is created, rather than being promoted to Approved past a live reviewer. The two cases are told apart by GitHub's timeline, the only place a review request carries a time.
- [x] A test for each that fails on `main` and passes with the fix; every existing test still passes, including the genuine re-request case.
- [x] The README's approval row names the rule.
- [x] `dist/` rebuilt and committed.
