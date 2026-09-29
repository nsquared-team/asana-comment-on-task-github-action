# Reviewers wait for green CI

## Goal

Reviewers are asked in Asana only for a PR that is ready for a person — CI green on the exact commit they would review, otto signed off, no conflict — in every repo whose CI reports to Asana, with no setup per repo.

Scope: one responsibility — CI's result on the PR's current commit gates the human review stage by default, on every path that calls a reviewer or promotes the task. The gate applies to a task once its CI has reported anything; a task CI never reports on behaves as today. A new `pending` CI status lets CI announce the commit it is testing. ⏩ Out: repos whose CI does not report to Asana (no signal to wait on); sending `pending` from each repo's CI (one PR per repo); re-pinning the synced asana.yaml (devops #25); withdrawing open requests on every push; GitHub's own review-request emails; approvals given on older commits. Shape: about 6 source files plus tests and dist.

Risk: live the moment it merges in every repo that runs the action at @main — today blinkmetrics-app, aaardvark-app and ssa-plugin, in both their review and CI workflows. The failure that matters is a PR that never gets reviewers because no green result matches its commit; `ci bypass` commits are covered and tested; a CI run that ends without posting a result holds the task until the next push or re-run. A PR opened ready on a task CI has never reported on still calls reviewers before its first run, and a red result then withdraws them. Proof is replay tests only. Undo: revert; @main consumers follow on their next event.

## Definition of Done

- [ ] A task CI has never reported on behaves exactly as today.
- [ ] Once CI has reported on a task, no human "Review" subtask is created unless CI's latest result is green for the PR's current commit — on every path: opened or reopened ready, marked ready for review, reviewer requested, the approval cascade, and the after-event re-check.
- [ ] Under that same condition the task never moves to Testing / Review or Approved; while CI is red it stays in Next.
- [ ] A green result for the current commit on a ready PR calls every reviewer the gate held back (after otto's stage, as today) and moves the task to Testing / Review; a task parked for a changes-request or a conflict stays parked.
- [ ] Every red result withdraws open review requests and parks the task in Next, whatever the previous result. Answered reviews are kept.
- [ ] A `pending` result records the commit CI is testing: it holds new calls and withdraws nothing. On top of a red result it writes nothing, so the red stands until CI reports again.
- [ ] A result for an older commit never counts for a newer one, except across commits whose subject line carries `ci bypass`.
- [ ] PR #4471's real sequence replays as a test and calls nobody: ready on a red commit, a red result, then a peer approval. One test per gated path fails on main and passes with the fix; existing tests that assert today's behavior on a CI-reported task are updated to the new rule, and every other test passes unchanged.
- [ ] The README documents the gate and the `pending` status, and dist/ matches a fresh build.
