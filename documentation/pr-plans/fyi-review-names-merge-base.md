# FYI Review labels name the branch the code landed on

## Goal

A reviewer reading an "FYI Review" subtask can tell whether the merged code shipped to a release branch — and which one — or only landed on another feature branch.

## Definition of Done

- [ ] A merge into `master`, `beta` or `production` renames a still-open "Review" subtask to "FYI Review - merged to <that branch>".
- [ ] A merge into any other branch renames it to "FYI Review - merged to sub-PR".
- [ ] Everything the plain rename already left alone — prefixed, answered and CI subtasks — is still left alone, so a re-run changes nothing.
- [ ] The README merge row states both label shapes.
- [ ] Tests go red when either label shape is removed.
