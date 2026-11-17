import * as format from "./format";

// The anchor shape, stated independently of the implementation so a change to it
// has to be a deliberate edit in two places.
const anchor = (href: string, label: string) =>
  `<a href="${href}"> 🔗 ${label} 🔗 </a>`;

const PR_URL = "https://github.com/nsquared-team/blinkmetrics-app/pull/4237";

const render = (raw: string, isReply = false) =>
  format.markdownToAsana(raw, { isReply }).body;

describe("links", () => {
  test("a markdown link labelled with its own url is linkified instead of failing the run", () => {
    // Verbatim from otto's code-review report. The old scrape read
    // `...4237](https://...4237` as ONE url and fed it to new RegExp: an
    // unterminated group, setFailed, and a red check on every report.
    const body = `**Fix scorecard digest giving up (and lying) when data is permanently stale** · [${PR_URL}](${PR_URL}) · @ali-al-najjar`;

    expect(render(body)).toContain(` · ${anchor(PR_URL, PR_URL)} · `);
  });

  test("a markdown link keeps its own text as the anchor label", () => {
    expect(
      render("See [the docs](https://example.com/docs) for details.")
    ).toEqual(
      `See ${anchor("https://example.com/docs", "the docs")} for details.`
    );
  });

  test("a markdown label containing brackets is still a label", () => {
    expect(
      render("See [[CRITICAL] fix this](https://example.com/foo) now")
    ).toEqual(
      `See ${anchor("https://example.com/foo", "[CRITICAL] fix this")} now`
    );
  });

  test("a bare url is linkified without eating the character after it", () => {
    expect(render("Check https://example.com/page for details.")).toEqual(
      `Check ${anchor("https://example.com/page", "Example Link")} for details.`
    );
    expect(render("See https://example.com/a, then stop")).toEqual(
      `See ${anchor("https://example.com/a", "Example Link")}, then stop`
    );
  });

  test("a trailing slash is trimmed from a bare url's href", () => {
    expect(render("Visit https://example.com/ today")).toEqual(
      `Visit ${anchor("https://example.com", "Example Link")} today`
    );
  });

  test("the same url twice becomes two anchors, not one nested inside the other", () => {
    expect(
      render("See https://example.com/a and https://example.com/a ok")
    ).toEqual(
      `See ${anchor("https://example.com/a", "Example Link")} and ${anchor(
        "https://example.com/a",
        "Example Link"
      )} ok`
    );
  });

  test("a url full of regex metacharacters keeps every character, with & escaped", () => {
    const url = "https://example.com/s?q=(a+b)*c^d$e|f{2}g&h=$&";
    expect(render(`Search ${url} now`)).toEqual(
      `Search ${anchor(
        "https://example.com/s?q=(a+b)*c^d$e|f{2}g&amp;h=$&amp;",
        "Example Link"
      )} now`
    );
  });

  test("a $& in a label is copied through literally", () => {
    expect(render("See [$& label](https://example.com/docs) now")).toEqual(
      `See ${anchor("https://example.com/docs", "$&amp; label")} now`
    );
  });

  test("markdown and html images both become one image attachment link", () => {
    const url = "https://example.com/a.png";
    expect(render(`![shot](${url})`)).toEqual(anchor(url, "Image Attachment"));
    expect(render(`<img width="1200" alt="shot" src="${url}" />`)).toEqual(
      anchor(url, "Image Attachment")
    );
    expect(render(`See: <img src="${url}"> there`)).toEqual(
      `See: ${anchor(url, "Image Attachment")} there`
    );
  });

  test("a link that is not a web url is kept as its text, never as an href Asana would refuse", () => {
    expect(render("mail me@example.com or [run](javascript:alert(1))")).toEqual(
      "mail me@example.com or run"
    );
  });
});

describe("markdown becomes Asana rich text", () => {
  test("the review-tier comment reads as headings, bold, code and a list, with its marker gone", () => {
    // The shape the review-tier lane posts. Before this, Asana showed
    // " !-- review-tier --", "## Review tier" and every `**` and backtick.
    const body = [
      "<!-- review-tier -->",
      "## Review tier",
      "",
      "**Tier:** `peer-only` -- rule `tests`: edits to tests.",
      "",
      "The merge lane merges this PR on its own once:",
      "- the PR targets master",
      "- `CI Gate` is green at HEAD",
      "",
      "_Lead review is not required for `peer-only`._",
    ].join("\n");

    expect(render(body)).toEqual(
      "<h2>Review tier</h2>" +
        "<strong>Tier:</strong> <code>peer-only</code> -- rule <code>tests</code>: edits to tests." +
        "\n\nThe merge lane merges this PR on its own once:" +
        "<ul><li>the PR targets master</li><li><code>CI Gate</code> is green at HEAD</li></ul>" +
        "<em>Lead review is not required for <code>peer-only</code>.</em>"
    );
  });

  test("h1 and h2 are headings; deeper ones, which Asana has no tag for, are bold lines", () => {
    expect(render("# One\n## Two\n### Three\n#### Four")).toEqual(
      "<h1>One</h1><h2>Two</h2><strong>Three</strong>\n\n<strong>Four</strong>"
    );
  });

  test("emphasis, strikethrough and code map to their tags, and snake_case stays plain", () => {
    expect(render("**b** _i_ *i* ~~s~~ `c` snake_case_name")).toEqual(
      "<strong>b</strong> <em>i</em> <em>i</em> <s>s</s> <code>c</code> snake_case_name"
    );
  });

  test("nested, numbered and task lists keep their structure", () => {
    expect(
      render("- a\n  - b\n- [x] done\n- [ ] open\n\n1. one\n2. two")
    ).toEqual(
      "<ul><li>a<ul><li>b</li></ul></li><li>☑ done</li><li>☐ open</li></ul>" +
        "<ol><li>one</li><li>two</li></ol>"
    );
  });

  test("a quote, a code block and a rule map to their blocks", () => {
    expect(render("> quoted\n\n```php\n$a && $b\n```\n\n---\n\nafter")).toEqual(
      "<blockquote>quoted</blockquote><pre>$a &amp;&amp; $b</pre><hr/>after"
    );
  });

  test("a table, which a story has no tag for, becomes one labelled bullet per row", () => {
    const table =
      "| Severity | Issues | Blocks |\n|---|---|---|\n| Critical | 0 | yes |\n| High | **2** | yes |";
    expect(render(table)).toEqual(
      "<ul><li><strong>Critical</strong> — Issues: 0 · Blocks: yes</li>" +
        "<li><strong>High</strong> — Issues: <strong>2</strong> · Blocks: yes</li></ul>"
    );
  });

  test("details is unwrapped with its summary as a bold line, and its content still renders", () => {
    expect(
      render("<details><summary>More</summary>\n\nInner **bold**\n\n</details>")
    ).toEqual("<strong>More</strong>\n\nInner <strong>bold</strong>");
  });

  test("raw html maps to Asana's tags where one exists and is dropped where none does", () => {
    expect(
      render("<b>bold</b> <code>x</code> a<br>b <sup>1</sup> <span>s</span>")
    ).toEqual("<strong>bold</strong> <code>x</code> a\nb 1 s");
  });

  test("an unclosed raw tag is closed, and a stray closing tag is dropped", () => {
    expect(render("<b>open and </i> never closed")).toEqual(
      "<strong>open and  never closed</strong>"
    );
  });

  test("shortcodes become emoji, but not inside code", () => {
    expect(render(":white_check_mark: done, `:x:` and :not_a_code:")).toEqual(
      "✅ done, <code>:x:</code> and :not_a_code:"
    );
  });
});

describe("escaping", () => {
  test("< > and & reach Asana as those characters, in code and out", () => {
    // stripQuotesAndArrows deleted every < and >, so `$x->where(` reached
    // Asana as `$x-where(` and `<x-foo>` as `x-foo`.
    expect(render("`$x->where(` and <x-foo> or a > b, R&D && done")).toEqual(
      "<code>$x-&gt;where(</code> and  or a &gt; b, R&amp;D &amp;&amp; done"
    );
    expect(render("```\n<x-foo> => 1\n```")).toEqual(
      "<pre>&lt;x-foo&gt; =&gt; 1</pre>"
    );
  });

  test("entities are decoded once and escaped again, never double escaped", () => {
    expect(render("it&#39;s &amp; &lt;b&gt;")).toEqual("it's &amp; &lt;b&gt;");
  });

  test("characters XML cannot carry are dropped rather than invalidating the body", () => {
    const nul = String.fromCharCode(0);
    const out = render(`a${nul}b${String.fromCharCode(0xd800)}c`);
    expect(out).toEqual("abc");
    expect(format.isValidAsanaHtml(`<body>${out}</body>`)).toBe(true);
  });
});

describe("mentions", () => {
  // MariamElZaatari is in src/constants/users.ts; nobody-here is not.
  test("an unknown handle is left as plain text", () => {
    const { body, mentionedAsanaIds } =
      format.markdownToAsana("cc @nobody-here");
    expect(body).toEqual("cc @nobody-here");
    expect(mentionedAsanaIds).toEqual([]);
  });

  test("every occurrence of a known handle is linked, and the id is listed once", () => {
    const { body, mentionedAsanaIds } = format.markdownToAsana(
      "@MariamElZaatari please look, thanks @MariamElZaatari"
    );
    expect(body.match(/<a href="https:\/\/app\.asana\.com/g)).toHaveLength(2);
    expect(body).not.toContain("@MariamElZaatari");
    expect(mentionedAsanaIds).toHaveLength(1);
  });

  test("a handle followed by punctuation is still found", () => {
    const { mentionedAsanaIds } = format.markdownToAsana(
      "thanks @MariamElZaatari's fix, @MariamElZaatari."
    );
    expect(mentionedAsanaIds).toHaveLength(1);
  });

  test("a handle in code, in a table cell and in a list item behaves as written", () => {
    const { body, mentionedAsanaIds } = format.markdownToAsana(
      "`@MariamElZaatari`\n\n- ask @MariamElZaatari\n\n| who |\n|---|\n| @MariamElZaatari |"
    );
    expect(body).toContain("<code>@MariamElZaatari</code>");
    expect(body.match(/<a href="https:\/\/app\.asana\.com/g)).toHaveLength(2);
    expect(mentionedAsanaIds).toHaveLength(1);
  });

  test("an email address is not read as a mention", () => {
    expect(
      format.markdownToAsana("write to x@MariamElZaatari.com").mentionedAsanaIds
    ).toEqual([]);
  });
});

describe("quote replies", () => {
  test("a reply typed directly under the quote survives", () => {
    // Markdown reads that line as part of the quote, so dropping the parsed
    // quote would drop the reply with it - and handleReview then posts nothing.
    expect(render("> quoted text\nmy actual reply", true)).toEqual(
      "my actual reply"
    );
  });

  test("a multi-line reply keeps its line breaks", () => {
    expect(render("> quoted\n\nfirst line\nsecond line", true)).toEqual(
      "first line\nsecond line"
    );
  });

  test("the blank separator after a quote is dropped, however many there are", () => {
    expect(render("> quoted\n\n\n\nreply", true)).toEqual("reply");
  });

  test("a reply that is nothing but quoted lines comes back empty", () => {
    expect(render("> only\n> quoted", true)).toEqual("");
  });

  test("a quote further down a reply is kept as a quote", () => {
    expect(render("> quoted\n\nreply\n\n> later quote", true)).toEqual(
      "reply<blockquote>later quote</blockquote>"
    );
  });
});

describe("isValidAsanaHtml", () => {
  test.each([
    ["an unknown tag", "<body><p>x</p></body>"],
    [
      "an attribute on a tag other than a",
      '<body><code class="x">x</code></body>',
    ],
    ["an anchor with no href", "<body><a>x</a></body>"],
    [
      "an anchor inside an anchor",
      '<body><a href="h"><a href="h">x</a></a></body>',
    ],
    ["unbalanced tags", "<body><strong>x</body>"],
    ["crossed tags", "<body><strong><em>x</strong></em></body>"],
    ["a bare ampersand", "<body>R&D</body>"],
    ["a stray angle bracket", "<body>a < b</body>"],
    ["a list item outside a list", "<body><li>x</li></body>"],
    ["a NUL character", `<body>a${String.fromCharCode(0)}</body>`],
  ])("rejects %s", (_name: string, html: string) => {
    expect(format.isValidAsanaHtml(html)).toBe(false);
  });

  test("accepts everything the renderer writes", () => {
    expect(
      format.isValidAsanaHtml(
        '<body><h1>a</h1><h2>b</h2><strong>c</strong><em>d</em><u>e</u><s>f</s><code>g</code><pre>h</pre><blockquote>i</blockquote><ul><li>j<ol><li>k</li></ol></li></ul><a href="https://x.com/?a=1&amp;b=&quot;2&quot;">l</a><hr/> &lt;&gt;&#39;</body>'
      )
    ).toBe(true);
  });
});

describe("size", () => {
  test("a body over Asana's limit is cut at a block with a note, instead of a 400 that posts nothing", () => {
    const paragraph = `${"word ".repeat(2000)}`;
    const body = render(Array(20).fill(paragraph).join("\n\n"));
    expect(Buffer.byteLength(body)).toBeLessThanOrEqual(
      format.BODY_BYTE_BUDGET
    );
    expect(body).toContain("The full text is on GitHub.");
    expect(format.isValidAsanaHtml(`<body>${body}</body>`)).toBe(true);
  });

  test("a single block too big to keep falls back to cut plain text, never mid-entity", () => {
    const body = render(`\`\`\`\n${"a<&>".repeat(30000)}\n\`\`\``);
    expect(Buffer.byteLength(body)).toBeLessThanOrEqual(
      format.BODY_BYTE_BUDGET
    );
    expect(body).toContain("The full text is on GitHub.");
    expect(format.isValidAsanaHtml(`<body>${body}</body>`)).toBe(true);
  });
});

describe("userMentionHTML", () => {
  test("an unmapped commenter's name is escaped", () => {
    expect(format.userMentionHTML("a<b>")).toEqual("@a&lt;b&gt;");
  });
});

describe("review findings", () => {
  test("an image inside a raw link is the link's text, not an empty anchor", () => {
    // Blacksmith's "Fix with smith" button is <a><picture><img alt></picture></a>;
    // dropping the img left <a href></a>, which shows nothing.
    expect(
      render(
        '<a href="https://x.com"><img alt="Fix with smith" src="https://x.com/a.png"></a>'
      )
    ).toEqual('<a href="https://x.com">Fix with smith</a>');
    expect(
      render('<a href="https://x.com"><img src="https://x.com/a.png"></a>')
    ).toEqual('<a href="https://x.com">Image Attachment</a>');
  });

  test("a raw link that renders to nothing is named after its site", () => {
    expect(
      render('see <a href="https://x.com/y"><span></span></a> here')
    ).toEqual(`see ${anchor("https://x.com/y", "X Link")} here`);
  });

  test("a > inside a quoted attribute does not break the tag", () => {
    expect(
      render('see <a title="x > y" href="https://x.com">t</a> ok')
    ).toEqual('see <a href="https://x.com">t</a> ok');
    expect(render('<img alt="a > b" src="https://a.com/i.png">')).toEqual(
      anchor("https://a.com/i.png", "Image Attachment")
    );
  });

  test("raw html inside a markdown link's label is dropped, not shown as tags", () => {
    expect(render("[<kbd>Esc</kbd> key](https://x.com)")).toEqual(
      anchor("https://x.com", "Esc key")
    );
  });

  test("an entity in a link's destination is escaped once", () => {
    expect(render("[x](https://a.com/?a=1&amp;b=2)")).toEqual(
      anchor("https://a.com/?a=1&amp;b=2", "x")
    );
  });

  test("a numbered list split by a paragraph keeps counting", () => {
    expect(render("1. one\n\nwhy\n\n2. two\n3. three")).toEqual(
      "<ol><li>one</li></ol>why<ul><li>2. two</li><li>3. three</li></ul>"
    );
  });

  test("every named HTML entity is decoded, and one without a semicolon is text", () => {
    expect(
      render("It&rsquo;s &ldquo;done&rdquo; &bull; &check; a=1&copy=2")
    ).toEqual("It’s “done” • ✓ a=1&amp;copy=2");
  });

  test("a GitHub alert renders as a labelled quote, and is not mistaken for a reply", () => {
    const body = "> [!CAUTION]\n> Do not merge until the migration has run.";
    expect(format.isReplyComment(body)).toBe(false);
    expect(render(body)).toEqual(
      "<blockquote><strong>🛑 Caution</strong>\n\nDo not merge until the migration has run.</blockquote>"
    );
  });

  test("raw ul, ol and li keep their bullets and numbers", () => {
    expect(render("<ol>\n<li>first</li>\n<li>second</li>\n</ol>")).toEqual(
      "1. first\n2. second"
    );
    expect(render("<ul><li>a</li><li>b</li></ul>")).toEqual("• a\n• b");
  });

  test("a table with headers and no rows keeps its headers", () => {
    expect(render("| Column A | Column B |\n|---|---|")).toEqual(
      "<ul><li><strong>Column A · Column B</strong></li></ul>"
    );
  });

  test("a quote or a rule inside a list item, which Asana answers with a 500, becomes the item's text", () => {
    const out = render("- a\n\n  > quoted\n\n  ***\n\n  b");
    expect(out).toEqual("<ul><li>a\n\nquoted\n\n———\n\nb</li></ul>");
    expect(format.isValidAsanaHtml(`<body>${out}</body>`)).toBe(true);
  });

  test("the validator refuses each nesting the live API answered with a 500", () => {
    expect(
      format.isValidAsanaHtml(
        "<body><ul><li><blockquote>q</blockquote></li></ul></body>"
      )
    ).toBe(false);
    expect(
      format.isValidAsanaHtml("<body><ul><li>a<hr/></li></ul></body>")
    ).toBe(false);
    expect(
      format.isValidAsanaHtml("<body><pre><code>c</code></pre></body>")
    ).toBe(false);
  });

  test("one list bigger than the budget is cut between its items, keeping the rest of the comment's start", () => {
    const items = Array.from(
      { length: 1500 },
      (_, i) => `- **item ${i}** with some text here`
    );
    const body = render(`intro\n\n${items.join("\n")}\n\nconclusion`);
    expect(Buffer.byteLength(body)).toBeLessThanOrEqual(
      format.BODY_BYTE_BUDGET
    );
    expect(body.startsWith("intro<ul><li><strong>item 0</strong>")).toBe(true);
    expect((body.match(/<li>/g) || []).length).toBeGreaterThan(1000);
    expect(body).toContain("The full text is on GitHub.");
    expect(format.isValidAsanaHtml(`<body>${body}</body>`)).toBe(true);
  });

  test("a table bigger than the budget is cut between rows instead of falling back to raw markdown", () => {
    const rows = Array.from(
      { length: 2000 },
      (_, i) => `| src/file${i}.ts | 9${i % 10}% |`
    );
    const body = render(`| file | cov |\n|---|---|\n${rows.join("\n")}`);
    expect(
      body.startsWith("<ul><li><strong>src/file0.ts</strong> — cov: 90%</li>")
    ).toBe(true);
    expect(body).not.toContain("|---|");
    expect(format.isValidAsanaHtml(`<body>${body}</body>`)).toBe(true);
  });

  test("a comment of many short paragraphs over the budget is cut quickly", () => {
    const started = Date.now();
    const body = render("a\n\n".repeat(21845));
    expect(Date.now() - started).toBeLessThan(3000);
    expect(Buffer.byteLength(body)).toBeLessThanOrEqual(
      format.BODY_BYTE_BUDGET
    );
  });

  test("the people a comment mentions still follow the task when it is posted as plain text", () => {
    const { body, mentionedAsanaIds } = format.markdownToAsana(
      `\`\`\`\n${"x".repeat(70000)}\n\`\`\`\n\n@MariamElZaatari see above`
    );
    expect(mentionedAsanaIds).toHaveLength(1);
    expect(format.isValidAsanaHtml(`<body>${body}</body>`)).toBe(true);
  });
});
