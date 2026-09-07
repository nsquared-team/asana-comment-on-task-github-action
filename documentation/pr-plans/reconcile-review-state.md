# Reconcile review state on every event

## Goal

A reviewer looking at Asana sees what GitHub says: a pull request that is up for review, mergeable and green carries a pending Review approval for every reviewer GitHub is still waiting on, whatever sequence of events led there.

## Definition of Done

- [ ] After every synced event, a pull request that is open, ready for review, mergeable, not rejected by CI and under no standing changes-request has its task in Testing / Review with a pending Review subtask for each active-tier reviewer GitHub is still waiting on.
- [ ] Resolving a merge conflict restores the Review subtasks the conflict alert cleared, on the next event that reaches the action.
- [ ] The reconcile never acts on a draft, a closed pull request, a conflicting one, unknown mergeability, a red CI verdict or a standing changes-request, and never pulls a task out of Blocked or a released column.
- [ ] Each of those bounds is covered by a test that goes red when it is removed, and the conflict-resolved path is proven through the action entry point.
- [ ] The README state machine states the invariant.
