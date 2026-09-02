import * as format from "./format";

// The anchor shape, stated independently of the implementation so a change to it
// has to be a deliberate edit in two places.
const anchor = (href: string, label: string) =>
  `<a href="${href}"> 🔗 ${label} 🔗 </a>`;

const PR_URL = "https://github.com/nsquared-team/blinkmetrics-app/pull/4237";

describe("linkifyBody", () => {
  test("a markdown link labelled with its own url is linkified instead of failing the run", () => {
    // Verbatim from otto's code-review report. The old scrape stopped only at
    // whitespace, so it read `...4237](https://...4237` as ONE url and fed it to
    // new RegExp, where the `(` opened a group nothing closed: "Invalid regular
    // expression ... Unterminated group", setFailed, and a red "Create a comment
    // in Asana Task" check on every report since 2026-08-14.
    const body = `**Fix scorecard digest giving up (and lying) when data is permanently stale** · [${PR_URL}](${PR_URL}) · @ali-al-najjar`;

    expect(format.linkifyBody(body)).toEqual(
      `**Fix scorecard digest giving up (and lying) when data is permanently stale** · ${anchor(
        PR_URL,
        PR_URL
      )} · @ali-al-najjar`
    );
  });

  test("a markdown link keeps its own text as the anchor label", () => {
    expect(
      format.linkifyBody(
        "See [the docs](https://example.com/docs) for details."
      )
    ).toEqual(
      `See ${anchor("https://example.com/docs", "the docs")} for details.`
    );
  });

  test("a markdown label containing brackets is still a label", () => {
    expect(
      format.linkifyBody(
        "See [[CRITICAL] fix this](https://example.com/foo) now"
      )
    ).toEqual(
      `See ${anchor("https://example.com/foo", "[CRITICAL] fix this")} now`
    );
  });

  test("a bare url is linkified without eating the character after it", () => {
    expect(
      format.linkifyBody("Check https://example.com/page for details.")
    ).toEqual(
      `Check ${anchor("https://example.com/page", "Example Link")} for details.`
    );
    expect(format.linkifyBody("See https://example.com/a, then stop")).toEqual(
      `See ${anchor("https://example.com/a", "Example Link")}, then stop`
    );
  });

  test("a bare url at the end of the body is still linkified", () => {
    expect(format.linkifyBody("Check https://example.com/page")).toEqual(
      `Check ${anchor("https://example.com/page", "Example Link")}`
    );
  });

  test("a trailing slash is trimmed from the href", () => {
    expect(format.linkifyBody("Visit https://example.com/")).toEqual(
      `Visit ${anchor("https://example.com", "Example Link")}`
    );
    expect(format.linkifyBody("Visit https://example.com/ today")).toEqual(
      `Visit ${anchor("https://example.com", "Example Link")} today`
    );
  });

  test("the same url twice becomes two anchors, not one nested inside the other", () => {
    expect(
      format.linkifyBody(
        "See https://example.com/a and https://example.com/a ok"
      )
    ).toEqual(
      `See ${anchor("https://example.com/a", "Example Link")} and ${anchor(
        "https://example.com/a",
        "Example Link"
      )} ok`
    );
  });

  test("a url that is a prefix of another one keeps its own href", () => {
    expect(
      format.linkifyBody(
        "First https://example.com/a then https://example.com/ab end"
      )
    ).toEqual(
      `First ${anchor("https://example.com/a", "Example Link")} then ${anchor(
        "https://example.com/ab",
        "Example Link"
      )} end`
    );
  });

  test("a url full of regex metacharacters is linkified instead of silently skipped", () => {
    const url = "https://example.com/s?q=(a+b)*c^d$e|f{2}g";
    expect(format.linkifyBody(`Search ${url} now`)).toEqual(
      `Search ${anchor(url, "Example Link")} now`
    );
  });

  test("a $& in a url or in a label is copied through literally", () => {
    expect(
      format.linkifyBody("Link https://example.com/p?a=$&b=2 done")
    ).toEqual(
      `Link ${anchor("https://example.com/p?a=$&b=2", "Example Link")} done`
    );
    expect(
      format.linkifyBody("See [$& label](https://example.com/docs) now")
    ).toEqual(`See ${anchor("https://example.com/docs", "$& label")} now`);
  });

  test("image markup becomes one image attachment link, whatever order its attributes are in", () => {
    // stripQuotesAndArrows has already removed the angle brackets by the time
    // linkifyBody sees an <img>, so this is the shape that actually arrives.
    const url = "https://example.com/a.png";
    expect(format.linkifyBody(`img src="${url}" alt="shot"`)).toEqual(
      `${anchor(url, "Image Attachment")} alt="shot"`
    );
    expect(
      format.linkifyBody(`img width="1200" alt="shot" src="${url}" /`)
    ).toEqual(`${anchor(url, "Image Attachment")} /`);
    expect(
      format.linkifyBody(`See:\nimg\n  src="${url}"\n  width="500" /`)
    ).toEqual(`See:\n${anchor(url, "Image Attachment")}\n  width="500" /`);
  });

  test("the word img in prose does not swallow the text up to a later image", () => {
    // `img` used to be a bare substring followed by "anything, lazily, up to a
    // url and a quote", so the prose, the markdown link and its text between the
    // two all vanished into one image anchor.
    expect(
      format.linkifyBody(
        'the img in [the docs](https://docs.example.com/a) and img src="https://y.com/b.png"'
      )
    ).toEqual(
      `the img in ${anchor(
        "https://docs.example.com/a",
        "the docs"
      )} and ${anchor("https://y.com/b.png", "Image Attachment")}`
    );
  });

  test("a body with no links, and an empty body, come back unchanged", () => {
    expect(format.linkifyBody("just a plain comment, no links")).toEqual(
      "just a plain comment, no links"
    );
    expect(format.linkifyBody("")).toEqual("");
  });

  test("a body carrying the placeholder character cannot forge or destroy an anchor", () => {
    // The placeholder is a real character a commenter can type. If it survived
    // into the output Asana would reject the whole html_text as invalid XML.
    const nul = String.fromCharCode(0);
    const out = format.linkifyBody(`${nul}0${nul} and https://example.com/a`);
    expect(out).toEqual(
      `0 and ${anchor("https://example.com/a", "Example Link")}`
    );
    expect(out).not.toContain(nul);
  });
});

describe("stripQuotesAndArrows", () => {
  test("a reply typed directly under the quote survives", () => {
    // kept.shift() dropped the first surviving line unconditionally, so this
    // whole reply became "" - and handleReview then returned without posting.
    expect(
      format.stripQuotesAndArrows("> quoted text\nmy actual reply")
    ).toEqual("my actual reply");
  });

  test("a multi-line reply keeps its line breaks", () => {
    expect(
      format.stripQuotesAndArrows("> quoted\n\nfirst line\nsecond line")
    ).toEqual("first line\nsecond line");
  });

  test("the blank separator after a quote is dropped, however many there are", () => {
    expect(format.stripQuotesAndArrows("> quoted\n\nreply")).toEqual("reply");
    expect(format.stripQuotesAndArrows("> quoted\n\n\n\nreply")).toEqual(
      "reply"
    );
  });

  test("a non-reply body keeps every line, and angle brackets are still stripped", () => {
    expect(format.stripQuotesAndArrows("line one\nline two > here")).toEqual(
      "line one\nline two  here"
    );
  });

  test("a reply that is nothing but quoted lines comes back empty", () => {
    expect(format.stripQuotesAndArrows("> only\n> quoted")).toEqual("");
  });
});

describe("replaceMentions", () => {
  // MariamElZaatari is in src/constants/users.ts; nobody-here is not.
  test("an unknown handle is left as plain text", () => {
    const { body, mentionedAsanaIds } =
      format.replaceMentions("cc @nobody-here");
    expect(body).toEqual("cc @nobody-here");
    expect(mentionedAsanaIds).toEqual([]);
  });

  test("every occurrence of a known handle is linked, and the id is listed once", () => {
    const { body, mentionedAsanaIds } = format.replaceMentions(
      "@MariamElZaatari please look, thanks @MariamElZaatari"
    );
    expect(body.match(/<a href="https:\/\/app\.asana\.com/g)).toHaveLength(2);
    expect(body).not.toContain("@MariamElZaatari");
    expect(mentionedAsanaIds).toHaveLength(1);
  });
});
