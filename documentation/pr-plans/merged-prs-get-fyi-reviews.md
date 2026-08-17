# Merged PRs turn their open reviews into FYI reviews

## Goal

A reviewer holding an unanswered review request on an already-merged pull request can see at a glance that nobody is waiting on them, without the record of who never answered being thrown away.

## Definition of Done

- [x] A merge renames the task's still-open reviewer approval subtasks from "Review" to "FYI Review".
- [x] A subtask already carrying its own prefix — "FYI Review" or anything else ending in "Review" — is left exactly as it is, so a re-run changes nothing.
- [x] A subtask marked complete is never touched, whatever it is called.
- [x] The "Automated CI Testing" subtask is never renamed.
- [x] A merge still deletes no approval subtasks, and a pull request closed without merging still deletes them all.
- [x] The README merge row states the rename.
- [x] The rename is covered by tests that go red when it is removed.
