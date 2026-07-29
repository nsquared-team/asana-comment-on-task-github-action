import * as utils from "./utils";

const MENTION_BASE_URL = "https://app.asana.com/0/";

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
      const lines = commentBody.split("\n");
      const kept = lines.filter((line: string) => line.indexOf(">") !== 0);
      kept.shift();
      commentBody = kept.join("");
    }
    commentBody = commentBody.replace(/>/g, "");
    commentBody = commentBody.replace(/</g, "");
  }
  return commentBody;
};

// Convert markdown images/hyperlinks/bare links into Asana anchor tags.
export const linkifyBody = (body: string): string => {
  let commentBody = body;
  const links = commentBody.match(/\bhttps?:\/\/\S+[\w|\/]/gi) || [];

  links.forEach((link: string) => {
    const linkRegex = link.replace(/\//gi, "\\/");
    const linkSite = link.replace(/.+\/\/|www.|\..+/g, "");
    const capitalLinkSite =
      linkSite.charAt(0).toUpperCase() + linkSite.slice(1);

    if (commentBody.includes(`src="${link}"`)) {
      const imageRegex = new RegExp(`img[\\w\\W]+?${linkRegex}"`, "gi");
      commentBody = commentBody.replace(
        imageRegex,
        `<a href="${link}"> 🔗 Image Attachment 🔗 </a>`
      );
    } else if (commentBody.includes(`(${link})`)) {
      const hyperlinkRegex = new RegExp(`\\[(.+?)\\]\\(${linkRegex}\\)`, "gi");
      const match = hyperlinkRegex.exec(commentBody);
      const label = match ? match[1] : `${capitalLinkSite} Link`;
      commentBody = commentBody.replace(
        hyperlinkRegex,
        `<a href="${link}"> 🔗 ${label} 🔗 </a>`
      );
    } else {
      let cleanLink = link;
      let defaultRegex = new RegExp(`\\S*?(${linkRegex}[^\\/]).*?`, "gi");
      const match = commentBody.match(defaultRegex);
      if (!match) {
        cleanLink = cleanLink.replace(/\?/gi, "\\?");
        defaultRegex = new RegExp(`\\S*?(${cleanLink}).*?`, "gi");
      }
      const href = link.replace(/\/$/, "");
      commentBody = commentBody.replace(
        defaultRegex,
        `<a href="${href}"> 🔗 ${capitalLinkSite} Link 🔗 </a>`
      );
    }
  });

  return commentBody;
};

// Replace @github-name mentions with Asana profile links; returns the Asana
// ids of mentioned users so callers can add them as followers.
export const replaceMentions = (
  body: string
): { body: string; mentionedAsanaIds: string[] } => {
  let commentBody = body;
  const mentionedAsanaIds: string[] = [];
  const mentions = commentBody.match(/@\S+\w/gi) || [];

  for (const mention of mentions) {
    const mentionUserObj = utils.findUserByGithubName(mention.substring(1));
    if (!mentionUserObj) continue;
    mentionedAsanaIds.push(mentionUserObj.asanaId);
    commentBody = commentBody.replace(
      mention,
      `<a href="${MENTION_BASE_URL}${mentionUserObj.asanaUrlId}">@${mentionUserObj.asanaName}</a>`
    );
  }

  return { body: commentBody, mentionedAsanaIds };
};
