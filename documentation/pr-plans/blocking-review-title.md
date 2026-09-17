# Blocking review title

## Goal

A reviewer looking at their Asana subtask can tell whether they are the last
person the PR is waiting on, without opening GitHub to count the other reviews.

## Definition of Done

- [x] A pending review subtask is titled "Blocking Review" exactly when its
  assignee is the only active-tier reviewer GitHub is still waiting on, and
  "Review" otherwise.
- [x] The title tracks GitHub's list: it is restated whenever the reviews on a
  PR change, so a subtask whose assignee stops being the last one is titled
  back down.
- [x] An approval dismissed after the title was applied leaves no subtask
  claiming to be the final blocker.
- [x] Reviewers requested together are never named the last blocker one at a
  time, whether their subtasks reach Asana in one run or in a run each; nor is
  a review named the blocker on the way to every review being cleared.
- [x] The "Automated CI Testing" subtask is never titled "Blocking Review" or
  otherwise renamed.
- [x] A subtask relabelled "FYI Review - merged to ..." on a merge does not get
  retitled.
- [x] The name matchers that identify a review subtask recognise the new title,
  so deletion, dedupe and merge relabelling behave the same as before it
  existed.
- [x] `dist/` matches a fresh build of the changed source.
