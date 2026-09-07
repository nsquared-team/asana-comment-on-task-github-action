# Reconcile review state on every event

## Goal

A reviewer looking at Asana sees what GitHub says: a pull request that is up for review, mergeable and green carries a pending Review approval for every reviewer GitHub is still waiting on, whatever sequence of events led there.

## Definition of Done

- [x] After every synced event, a pull request that is open, ready for review, mergeable, not rejected by CI and under no standing changes-request has its task in Testing / Review with a pending Review subtask for each active-tier reviewer GitHub is still waiting on.
- [x] Resolving a merge conflict restores the Review subtasks the conflict alert cleared, on the next event that reaches the action.
- [x] The reconcile never acts on a draft, a closed pull request, a conflicting one, unknown mergeability, a red CI verdict, a standing changes-request or a task a person has completed, and never pulls a task out of Blocked, Done or a released column.
- [x] Each of those bounds is covered by a test that goes red when it is removed, and the conflict-resolved path is proven through the action entry point.
- [x] The same re-check promotes a task to Approved once every tier has approved, marks a pending Review subtask approved when its reviewer already approved on GitHub, and a dismissal re-requests its reviewer once, without waiting for another approval.
- [x] Restating changes nothing a person would notice when Asana already matches: a task in its section stays in place and a reviewer asked to review again is waited on.
- [x] A "Comment" review from a tier reviewer is a rejection whether it carries a summary or only notes on the diff: it parks the task like changes requested and holds the re-check until that reviewer is re-requested; a lone reply in a thread, the author's own notes, or a bot's comment review does not.
- [x] The README state machine states the invariant.
