# An approval is needed only once

## Goal

A reviewer's approval is asked for once: it stands until they change their own verdict or it is explicitly dismissed — a later changes-request from someone else (bots included) never invalidates it or sends them back to the review queue.

## Definition of Done

- [x] A changes-request no longer invalidates other reviewers' earlier approvals: a tier whose reviewers have all approved stays satisfied through later changes-requests from other reviewers or bots, and its members are never re-requested.
- [x] A reviewer's own standing changes-request still counts against their tier until they approve, and a dismissed approval still stops counting and resummons its reviewer.
- [x] Jest covers the standing-approval shape (an approval predating someone else's changes-request still counts and triggers no re-request) and the kept behaviors (dismissed resummon, already-pending skip, bot and standing changes-request never resummoned, failed re-request doesn't throw).
- [x] `dist/` matches a fresh build of the changed source.
- [x] The README's approval-cascade row and `github-pat` input row state the new policy.
