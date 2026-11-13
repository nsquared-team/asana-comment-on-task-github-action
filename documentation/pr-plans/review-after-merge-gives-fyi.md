# An approval after the merge leaves an FYI, not a Review

## Goal

A reviewer whose turn comes up after the pull request has merged finds an FYI review on their Asana board, never a "Review" or "Blocking Review" saying merged code is waiting on them.

Focus of this PR: a reviewer reached after the merge gets an FYI review — the approval cascade's FYI path on a merged pull request only, nothing else.

Scope: the approval cascade in the review handler. In: on a merged pull request the cascade gives each reviewer it reaches the "FYI Review - merged to <base>" subtask a merge leaves, and no longer moves the task to Approved; the README's approval row; the tests. ⏩ Out: a reviewer requested on GitHub after the merge; a changes-request or a dismissal after the merge; CI turning green after the merge; a reviewer who reaches the merge with no subtask. Shape: three source files (the review handler, its tests, the README) plus the rebuilt bundle, about 80 changed lines.

Risk: every repo running the sync takes this on its next version bump. Only review events on a merged pull request change; an open pull request takes today's path. Undo: revert the one commit. The load-bearing 1%: the merged check reads the pull request GitHub returns fresh inside the cascade, the same read the conflict guard uses.

## Definition of Done

- [ ] On a merged pull request, an approval or an otto answer creates "FYI Review - merged to <base>" for each reviewer the cascade reaches, carrying the merge's "nobody is waiting on you" note.
- [ ] That run creates no "Review" or "Blocking Review" subtask and deletes no approval subtask.
- [ ] A reviewer who already holds an approval subtask on the task, in any state, gets no second one.
- [ ] A late approval never moves a merged pull request's task to Approved.
- [ ] On an open pull request the cascade creates the same subtasks under the same names and promotes as before.
- [ ] The README's approval row says what an approval after the merge does.
- [ ] The new tests fail when the merged check is removed.
- [ ] Every place the cascade hands out a review takes the FYI path on a merged pull request, shown by the search over its call sites.
