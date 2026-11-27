# A pull request that has ended asks for no review and keeps its record

## Goal

A reviewer never finds a "Review" on their Asana board for a pull request that has merged or been closed: merged work leaves an FYI review that stays, abandoned work leaves nothing.

Focus of this PR: no review is asked for or erased once a pull request ends — the sync's review writes on a closed or merged pull request only, nothing else.

Scope: every place the sync hands out a "Review" from an event, and the CI verdict that clears them. In: on a merged pull request the pull request handler gives each reviewer it would call the "FYI Review - merged to <base>" subtask, leaves the task in its column and deletes no approval subtask; a reviewer requested after the merge gets that FYI whatever their tier; on a pull request closed without merging the pull request handler, the CI handler and the approval cascade call nobody and move nothing; CI turning green after the merge calls nobody and moves nothing; a red CI verdict after the merge or the close deletes no approval subtask and moves nothing; the README's rows; the tests. ⏩ Out: a changes-request or a dismissal after the merge; a late approval promoting a closed pull request's task; restoring subtasks that earlier runs deleted. Shape: five source files (the pull request, CI and review handlers, the tests, the README) plus the rebuilt bundle, about 480 changed lines.

Risk: every repo running the sync takes this on its next version bump. Only events on a pull request that has merged or closed change; an open pull request takes today's path. Undo: revert the branch's commits. The load-bearing 1%: where the pull request stands is read from GitHub fresh, so an event fired before the merge or the close and handled after it is treated as merged or closed too.

## Definition of Done

- [x] On a merged pull request, a review request creates "FYI Review - merged to <base>" for the requested reviewer, carrying the merge's "nobody is waiting on you" note.
- [x] That run creates no "Review" or "Blocking Review" subtask, deletes no approval subtask and moves the task to no section.
- [x] A reviewer who already holds an approval subtask on the task, in any state, gets no second one.
- [x] A review request made before the merge and handled after it takes the FYI path.
- [x] On an open pull request a review request creates the same subtasks under the same names and moves the task as before.
- [x] The README's review request row says what a request does on a pull request that has already merged.
- [x] The new tests fail when the merged check is removed.
- [x] No other place in the pull request handler hands out a "Review" on a merged pull request, shown by the search over its call sites.
- [x] A reviewer outside the active tier who is requested on a merged pull request gets the FYI review.
- [x] A review request or a ready event handled after a close without a merge creates no approval subtask and moves the task to no section.
- [x] CI turning green on a pull request that has merged or closed creates no approval subtask and moves the task to no section, and its verdict is still recorded.
- [x] An approval that lands on a pull request closed without merging hands the next tier no subtask.
- [x] A pull request GitHub cannot return is handled as its payload describes it.
- [x] The README's rows for a review request, a CI verdict and an approval say what each does on a pull request that has merged or closed.
- [x] The tests for these fail against the handlers as they were before this change.
- [x] No hand-out of a "Review" anywhere in the project runs without the open check, shown by the search over the hand-out's call sites.
- [x] A red CI verdict on a pull request that has merged or closed deletes no approval subtask and moves the task to no section, and its verdict is still recorded.
- [x] On an open pull request a red CI verdict still clears the pending reviews and moves the task to Next.
