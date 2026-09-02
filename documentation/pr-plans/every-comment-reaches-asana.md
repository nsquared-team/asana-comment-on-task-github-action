# Every comment reaches Asana

## Goal

Every pull request comment and review reaches its Asana task whatever it says. Comment text is data: nobody — otto, a reviewer, or anyone who can type in a comment box — can fail the "Create a comment in Asana Task" check, or quietly lose their comment, with the characters they happened to use.

## Definition of Done

- [x] A markdown link labelled with its own url — what otto's code-review report has written on every run since 2026-08-14 — is linkified instead of throwing `Invalid regular expression … Unterminated group`, so the check stops failing on PRs 4054, 4184, 4237, 4308, 4326, 4515 and 4521, for review events and comment events alike.
- [x] Nothing scraped from a comment is compiled as a regular expression or used as a `String.replace` replacement string, so a url or a label containing `(`, `?`, `+`, `*` or `$&` survives verbatim in both the href and the anchor text instead of throwing, being silently skipped, or splicing the match back into the output.
- [x] Every url in a body gets its own anchor: the same url twice no longer nests one anchor inside another, a url that is a prefix of another no longer steals its href, and the character after a bare url is no longer swallowed.
- [x] An `@handle` that appears inside a url is never replaced inside that url's href, and the real mention further down the comment is linked instead — every occurrence of it, not just the first.
- [x] A reply typed directly under the quoted text still reaches Asana instead of arriving empty, and a multi-line reply keeps its line breaks.
- [x] The CI sandbox block's input is never expanded as a replacement pattern, and the block still refreshes exactly as it did before: ssa-plugin writes one twice per CI run, so a body ends with two blocks and both carry the current run's links.
- [x] A pull request description that links two different Asana tasks as `[url-a](url-b)` syncs to both.
- [x] What already worked is pinned unchanged: a markdown link keeps its text as its label, a url at the end of a body is still linkified, a trailing slash is still trimmed from the href, image markup still becomes a single "Image Attachment" link, and a body with no links comes back untouched.
- [x] Jest covers all of it — `src/format.test.ts` starting from the verbatim report line that failed in production, plus handler tests in `src/handlers/transitions.test.ts` proving `handleReview` posts that report to Asana, that a handle inside a url is never linked into that url's href, and that a CI run still leaves two current sandbox blocks. 17 of them fail against the previous implementation, and the two-block test kills both narrower refresh strategies.
- [x] `dist/` matches a fresh build of the changed source.
