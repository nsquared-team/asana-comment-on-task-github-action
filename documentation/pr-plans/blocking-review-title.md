# Blocking review title

## Goal

A reviewer looking at their Asana subtask can tell whether they are the last
person the PR is waiting on, without opening GitHub to count the other reviews.

## Definition of Done

- A pending review subtask is titled "Blocking Review" exactly when it is the
  only pending review subtask left on the task, and "Review" otherwise.
- The title tracks the live count: it is recomputed whenever the reviews on a
  PR change, so a subtask that stops being the last one is titled back down.
- An approval dismissed after the title was applied leaves no subtask claiming
  to be the final blocker.
- The "Automated CI Testing" subtask is never titled "Blocking Review", and is
  never counted as one of the pending reviews.
- A subtask relabelled "FYI Review - merged to ..." on a merge is not counted
  and does not get retitled.
- The name matchers that identify a review subtask recognise the new title, so
  deletion, dedupe and merge relabelling behave the same as before it existed.
