# Conflict invalidates approvals

## Goal

A reviewer reading Asana sees a conflicting pull request as still needing review, so nobody merges a conflict resolution that no one has looked at.

## Definition of Done

- [ ] Otto's merge-conflict alert clears the task's pending Review subtasks, the same way a changes-requested review does.
- [ ] A task never lands in Approved while its pull request has a merge conflict, whichever tier's approval arrives.
- [ ] An approval on a conflicting pull request creates no next-tier Review subtasks.
- [ ] A pull request whose mergeability GitHub has not computed yet counts as mergeable, so an unknown state never silently parks a task.
- [ ] The merge-conflict path is covered by tests that go red when the guard is removed.
- [ ] The README state machine states what a conflict does to approvals.
