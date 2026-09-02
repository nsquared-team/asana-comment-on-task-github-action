import * as utils from "./utils";

const MENTION_BASE_URL = "https://app.asana.com/0/";

// Comment text is data, never a pattern. Every regex below is a literal and
// every replacement is a function, so nothing scraped from a comment is ever
// compiled or interpreted: a `[url](url)` pair used to be read as one "url"
// whose `](` opened a group nothing closed, which failed the whole action, and
// a `$&` in a url or a label used to splice the match back into the output.
//
// U+0000 marks a finished anchor. Spelled as a call rather than an escape so it
// stays visible in review and no formatter can quietly normalise it to a space.
const SENTINEL = String.fromCharCode(0);

const IMAGE_MARKUP = new RegExp(
  `img(?:\\s+[\\w:-]+="[^"\\n]*")*?\\s+src="(https?://[^\\s"${SENTINEL}]+)"`,
  "gi"
);
// A url ends at whitespace or at any bracket or quote - the characters markdown
// uses to delimit one - so a link can never run past its own closing bracket.
const MARKDOWN_LINK = new RegExp(
  `\\[([^\\n${SENTINEL}]{0,300}?)\\]\\((https?://[^\\s)"${SENTINEL}]+)\\)`,
  "gi"
);
// Parentheses stay legal inside a bare url so a query string survives intact;
// markdown pairs are already consumed above, and the closing `)` of a
// parenthetical is dropped anyway by the trailing `[\w/]`.
const BARE_URL = new RegExp(
  `\\bhttps?://[^\\s<>\\[\\]"${SENTINEL}]*[\\w/]`,
  "gi"
);
const MENTION = new RegExp(`@[^\\s${SENTINEL}]+\\w`, "gi");
const STASHED_ANCHOR = new RegExp(`${SENTINEL}(\\d+)${SENTINEL}`, "g");

const siteName = (url: string) => {
  const site = url.replace(/^[a-z]+:\/\/(www\.)?/i, "").split(/[./]/)[0];
  return `${site.charAt(0).toUpperCase()}${site.slice(1)}`;
};

const anchor = (url: string, label: string) =>
  `<a href="${url}"> 🔗 ${label} 🔗 </a>`;

export const userMentionHTML = (githubName?: string) => {
  const userObj = utils.findUserByGithubName(githubName);
  if (!userObj) return `@${githubName || "unknown"}`;
  return `<a href="${MENTION_BASE_URL}${userObj.asanaUrlId}">@${userObj.asanaName}</a>`;
};

export const isReplyComment = (body: string) => body.charAt(0) === ">";

// Strip quoted reply blocks and raw angle brackets (Asana html_text rejects them).
export const stripQuotesAndArrows = (body: string): string => {
  let commentBody = body;
  if (commentBody.includes(">") || commentBody.includes("<")) {
    if (isReplyComment(commentBody)) {
      const kept = commentBody
        .split("\n")
        .filter((line: string) => line.indexOf(">") !== 0);
      // What follows the quote is a blank separator line, so drop it - but only
      // when it IS one. Dropping the first kept line unconditionally deleted the
      // whole reply whenever the author typed it directly under the quote, and
      // handleReview then returned early without posting anything at all.
      while (kept.length && !kept[0].trim()) kept.shift();
      commentBody = kept.join("\n");
    }
    commentBody = commentBody.replace(/>/g, "");
    commentBody = commentBody.replace(/</g, "");
  }
  return commentBody;
};

// Convert markdown images/hyperlinks/bare links into Asana anchor tags, leaving
// each finished anchor parked behind a placeholder. Nothing that runs afterwards
// - a later pattern here, or replaceMentions - can then match a url sitting
// inside an href we just wrote, which is what produced nested `<a <a href=...>`
// and mentions spliced into link targets.
export const linkifyToPlaceholders = (
  body: string
): { text: string; anchors: string[] } => {
  const anchors: string[] = [];
  const stash = (html: string) => {
    anchors.push(html);
    return `${SENTINEL}${anchors.length - 1}${SENTINEL}`;
  };

  const text = body
    .split(SENTINEL)
    .join("")
    .replace(IMAGE_MARKUP, (_match: string, url: string) =>
      stash(anchor(url, "Image Attachment"))
    )
    .replace(MARKDOWN_LINK, (_match: string, label: string, url: string) =>
      stash(anchor(url, label || `${siteName(url)} Link`))
    )
    .replace(BARE_URL, (url: string) =>
      stash(anchor(url.replace(/\/$/, ""), `${siteName(url)} Link`))
    );

  return { text, anchors };
};

export const restoreAnchors = (text: string, anchors: string[]): string =>
  text.replace(STASHED_ANCHOR, (match: string, index: string) => {
    const html = anchors[Number(index)];
    return html === undefined ? match : html;
  });

export const linkifyBody = (body: string): string => {
  const { text, anchors } = linkifyToPlaceholders(body);
  return restoreAnchors(text, anchors);
};

// Replace @github-name mentions with Asana profile links; returns the Asana
// ids of mentioned users so callers can add them as followers.
export const replaceMentions = (
  body: string
): { body: string; mentionedAsanaIds: string[] } => {
  const mentionedAsanaIds: string[] = [];

  // Each occurrence is resolved where it sits. Replacing by string needle hit
  // the FIRST match anywhere in the body, so a url containing a known handle
  // took the replacement into its own href and the real mention further down
  // was the one left as plain text.
  const withMentions = body.replace(MENTION, (mention: string) => {
    const mentionUserObj = utils.findUserByGithubName(mention.substring(1));
    if (!mentionUserObj) return mention;
    if (!mentionedAsanaIds.includes(mentionUserObj.asanaId))
      mentionedAsanaIds.push(mentionUserObj.asanaId);
    return `<a href="${MENTION_BASE_URL}${mentionUserObj.asanaUrlId}">@${mentionUserObj.asanaName}</a>`;
  });

  return { body: withMentions, mentionedAsanaIds };
};
