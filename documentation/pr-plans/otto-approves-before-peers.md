# Otto approves before peers

## Goal

When otto is added to a PR, a peer developer is asked to review it in Asana
only once otto has approved: otto becomes the first stage of the approval
cascade, ahead of PEER_DEV → DEV → QA, so nobody is called to review a PR that
may still need work. When otto is not on the PR, the cascade runs
PEER_DEV → DEV → QA exactly as today.

## Definition of Done

- [x] A PR otto is not on, because GitHub does not list it as requested and it
  has no standing verdict, calls its peers as before, and the cascade runs on
  to DEV and QA unchanged.
- [x] While otto is on the PR and still to answer, because GitHub lists it as
  requested or its standing verdict is a changes-request, no human-tier
  "Review" subtask is created, on every path that creates one: a PR opened or
  reopened ready, marked ready for review, a reviewer requested, CI going green
  again, the approval cascade, and the after-event re-check.
- [x] Otto's approval opens the peer stage on the run for that approval: the
  active tier gets its "Review" subtasks and the task sits in Testing / Review,
  even when GitHub's reviewer list has not yet dropped otto. From there the
  cascade continues to DEV and QA as today.
- [x] Otto's comment-only report, how it files findings below its blocking
  bar, is its answer too: it opens the stage the way its approval does unless
  a changes-request from otto stands before it, which it inherits.
- [x] Re-requesting otto after it approved closes the stage again until it
  answers: no new reviewer is called meanwhile, and subtasks already handed
  out are left alone.
- [x] A task waiting on otto is never moved to Approved, whatever the human
  tiers say; once otto has approved, standing human approvals count as before.
- [x] Dismissing otto's approval asks it again once, which keeps the stage
  closed until it answers; dismissing its changes-request overrules it, and
  otto is not asked again.
- [x] Otto's verdict is read from every page of the PR's reviews, and a
  review not yet submitted or from a deleted account can neither hide it nor
  break the read.
- [x] Waiting on otto never deletes a subtask and never keeps a task from
  moving to Testing / Review.
- [x] A test per gated path that fails on `main` and passes with the fix, and
  a guard per path that must stay unchanged; every existing test passes, with
  the one asserting otto's changes-request cannot block a fully approved PR
  flipped to the new rule.
- [x] The README's ready-for-review and approval rows, the re-check paragraph,
  and the People and teams section name otto's stage.
- [x] `dist/` matches a fresh build of the changed source.
