# A merged PR leaves an FYI review for every assigned reviewer

## Goal

A reviewer assigned to a pull request that merges before they answered finds an FYI review on their Asana board, whether or not a review subtask had already been created for them.

## Definition of Done

- [x] A merge creates an "FYI Review - merged to <base>" subtask for each active-tier reviewer still requested on the pull request who has no approval subtask on the task.
- [x] A reviewer who already has one — pending, answered, or the subtask this same merge just renamed — never gets a second.
- [x] The existing rename still runs, and replaying the same merge event creates and renames nothing.
- [x] The per-reviewer duplicate cleanup matches FYI reviews too, so overlapping sync runs converge on one subtask per reviewer instead of leaving a "Review" and an "FYI Review" side by side.
- [x] The merge still deletes no approval subtask: creating an FYI never runs the tier cascade cleanup, so another tier's record survives and the new subtask is not swept away with it.
- [x] The "Automated CI Testing" subtask is never renamed, duplicated, or counted as a reviewer's approval.
- [x] A pull request closed without merging still deletes the approval subtasks and creates none.
- [x] The README merge row states that a merge also creates the missing FYI reviews.
- [x] Tests go red when the create, the per-reviewer guard, or the widened cleanup is removed.
- [x] A reviewer who already has a subtask still has any duplicate pair healed by the merge, not left standing.
