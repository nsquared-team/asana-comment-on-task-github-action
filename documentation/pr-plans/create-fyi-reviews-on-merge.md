# A merged PR leaves an FYI review for every assigned reviewer

## Goal

A reviewer assigned to a pull request that merges before they answered finds an FYI review on their Asana board, whether or not a review subtask had already been created for them.

## Definition of Done

- [ ] A merge creates an "FYI Review - merged to <base>" subtask for each active-tier reviewer still requested on the pull request who has no approval subtask on the task.
- [ ] A reviewer who already has one — pending, answered, or the subtask this same merge just renamed — never gets a second.
- [ ] The existing rename still runs, and replaying the same merge event creates and renames nothing.
- [ ] The per-reviewer duplicate cleanup matches FYI reviews too, so overlapping sync runs converge on one subtask per reviewer instead of leaving a "Review" and an "FYI Review" side by side.
- [ ] The "Automated CI Testing" subtask is never renamed, duplicated, or counted as a reviewer's approval.
- [ ] A pull request closed without merging still deletes the approval subtasks and creates none.
- [ ] The README merge row states that a merge also creates the missing FYI reviews.
- [ ] Tests go red when the create, the per-reviewer guard, or the widened cleanup is removed.
