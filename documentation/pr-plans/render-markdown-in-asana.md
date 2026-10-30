# Render a comment's Markdown in Asana

## Goal

Everyone reading a PR's Asana task sees its comments and reviews formatted the way GitHub shows them — headings, bold, code, lists, quotes and links — instead of raw Markdown, a stray `!-- review-tier --` marker, and code with its `<` and `>` deleted.

## Definition of Done

- [ ] Headings, bold, italic, strikethrough, inline code, code blocks, bullet, numbered, nested and task lists, quotes, horizontal rules and links in a comment or review reach Asana as rich text, not as Markdown characters.
- [ ] Constructs Asana has no tag for still read cleanly: an HTML comment such as `<!-- review-tier -->` disappears, a table becomes one bullet per row, `<details>` is unwrapped, `:white_check_mark:` and the other shortcodes our bots use become their emoji.
- [ ] A literal `<`, `>` or `&` reaches Asana as GitHub shows it instead of being deleted: `$x->where(` and `<x-foo>` in code, `a > b`, `a && b` and `?a=1&b=2` in prose all survive verbatim.
- [ ] The action only ever sends tags Asana accepts, checked before every post and edit: one unsupported tag makes Asana show the whole comment as raw HTML, so a body that fails the check is posted as plain text instead.
- [ ] A comment longer than Asana's 65,400-byte limit is cut at a block boundary with a note pointing to the full text on GitHub, instead of the post failing.
- [ ] Links, `@mentions` and the "Image Attachment" link work as before, and are never applied inside code.
- [ ] What depended on the old text still works: a quote reply posts only the reply, otto's merge-conflict alert still moves the task to Next, and an edited or deleted GitHub comment still finds its Asana story.
- [ ] The review-tier, review-tier-merged, Code Review Report and Semgrep comments, converted by this code, render correctly as comments on a real Asana task.
- [ ] `dist/` matches a fresh build of the changed source.
