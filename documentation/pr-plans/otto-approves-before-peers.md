# Otto approves before peers

## Goal

When otto is added to a PR, a peer developer is asked to review it in Asana
only once otto has approved: otto becomes the first stage of the approval
cascade, ahead of PEER_DEV → DEV → QA, so nobody is called to review a PR that
may still need work. When otto is not on the PR, the cascade runs
PEER_DEV → DEV → QA exactly as today.

## Definition of Done

- [ ] A PR otto is not on, because GitHub does not list it as requested and it
  has submitted no review, calls its peers as before, and the cascade runs on
  to DEV and QA unchanged.
- [ ] While otto is on the PR and still to answer, because GitHub lists it as
  requested or its latest review is anything but an approval (changes
  requested, a comment-only report, a dismissed approval), no human-tier
  "Review" subtask is created, on every path that creates one: a PR opened or
  reopened ready, marked ready for review, a reviewer requested, CI going green
  again, the approval cascade, and the after-event re-check.
- [ ] Otto's approval opens the peer stage on the run for that approval: the
  active tier gets its "Review" subtasks and the task sits in Testing / Review,
  even when GitHub's reviewer list has not yet dropped otto. From there the
  cascade continues to DEV and QA as today.
- [ ] Re-requesting otto after it approved closes the stage again until it
  answers: no new reviewer is called meanwhile, and subtasks already handed
  out are left alone.
- [ ] A task waiting on otto is never moved to Approved, whatever the human
  tiers say; once otto has approved, standing human approvals count as before.
- [ ] Waiting on otto never deletes a subtask and never keeps a task from
  moving to Testing / Review.
- [ ] A test per path that fails on `main` and passes with the fix; every
  existing test passes, with the one asserting otto's changes-request cannot
  block a fully approved PR flipped to the new rule.
- [ ] The README's ready-for-review and approval rows, the re-check paragraph,
  and the People and teams section name otto's stage.
- [ ] `dist/` matches a fresh build of the changed source.
