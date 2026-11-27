# A review request after the merge leaves an FYI, not a Review

## Goal

A reviewer requested on a pull request that has already merged finds an FYI review on their Asana board, never a "Review" saying merged code is waiting on them.

Focus of this PR: a reviewer requested after the merge gets an FYI review — the pull request handler's review hand-out on a merged pull request only, nothing else.

Scope: the pull request handler, where a review request or a ready event hands out reviews. In: on a merged pull request it gives each reviewer it would call the "FYI Review - merged to <base>" subtask, leaves the task in its column and deletes no approval subtask; the README's row; the tests. ⏩ Out: a changes-request or a dismissal after the merge; CI turning green after the merge; restoring subtasks that earlier runs deleted. Shape: four source files (the pull request handler, the review handler that holds the GitHub reads, the tests, the README) plus the rebuilt bundle, about 170 changed lines.

Risk: every repo running the sync takes this on its next version bump. Only pull request events on a merged pull request change; an open pull request takes today's path. Undo: revert the one commit. The load-bearing 1%: the merged check reads the pull request GitHub returns fresh, so a request made before the merge and handled after it takes the FYI path too.

## Definition of Done

- [x] On a merged pull request, a review request creates "FYI Review - merged to <base>" for the requested reviewer, carrying the merge's "nobody is waiting on you" note.
- [x] That run creates no "Review" or "Blocking Review" subtask, deletes no approval subtask and moves the task to no section.
- [x] A reviewer who already holds an approval subtask on the task, in any state, gets no second one.
- [x] A review request made before the merge and handled after it takes the FYI path.
- [x] On an open pull request a review request creates the same subtasks under the same names and moves the task as before.
- [x] The README's review request row says what a request does on a pull request that has already merged.
- [x] The new tests fail when the merged check is removed.
- [x] No other place in the pull request handler hands out a "Review" on a merged pull request, shown by the search over its call sites.
