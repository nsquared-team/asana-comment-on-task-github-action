# Blocking review title

## Goal

A reviewer looking at their Asana subtask can tell whether they are the last
person the PR is waiting on, without opening GitHub to count the other reviews.

## Definition of Done

- [x] A pending review subtask is titled "Blocking Review" exactly when it is
  the only pending review subtask left on the task, and "Review" otherwise.
- [x] The title tracks the live count: it is recomputed whenever the reviews on
  a PR change, so a subtask that stops being the last one is titled back down.
- [x] An approval dismissed after the title was applied leaves no subtask
  claiming to be the final blocker.
- [x] A run that summons several reviewers at once, or clears every review at
  once, never names one of them the last blocker on the way.
- [x] The "Automated CI Testing" subtask is never titled "Blocking Review", and
  is never counted as one of the pending reviews.
- [x] A subtask relabelled "FYI Review - merged to ..." on a merge is not
  counted and does not get retitled.
- [x] The name matchers that identify a review subtask recognise the new title,
  so deletion, dedupe and merge relabelling behave the same as before it
  existed.
- [x] `dist/` matches a fresh build of the changed source.
