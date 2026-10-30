import { Lexer } from "marked";
import type { Token, Tokens } from "marked";
import * as utils from "./utils";

const MENTION_BASE_URL = "https://app.asana.com/0/";

// Asana stores a story's html_text as XML and checks it against a short tag
// list. It never rejects a body for the tags in it: one it does not accept
// makes Asana keep the WHOLE body as literal text, so a single stray <p> shows
// the reader every tag in the comment. Only the renderer below writes tags,
// only from this list, and isValidAsanaHtml checks the result before it is sent.
//
// h1, h2, hr, nested lists, inline tags nested in each other, and pre inside a
// list item were each posted to a live task and kept as rich text. The docs
// list fewer for stories; the live API is the authority.
const ALLOWED_TAGS = new Set([
  "body",
  "h1",
  "h2",
  "strong",
  "em",
  "u",
  "s",
  "code",
  "pre",
  "blockquote",
  "ul",
  "ol",
  "li",
  "a",
  "hr",
]);
const BLOCK_TAGS = ["h1", "h2", "ul", "ol", "pre", "blockquote", "hr"];

// html_text over 65,400 bytes is refused with a 400, which fails the run and
// posts nothing. The budget leaves room for the wrapper the handlers add.
export const BODY_BYTE_BUDGET = 64000;
const TRUNCATED_NOTE =
  "<em>Cut to fit Asana's comment size limit. The full text is on GitHub.</em>";

// The characters XML 1.0 can carry. Anything else (a control character, a
// lone surrogate, U+FFFE) invalidates the body however it is escaped. Iterating
// a string yields code points, so a lone surrogate arrives here on its own.
const isXmlChar = (codePoint: number) =>
  codePoint === 0x9 ||
  codePoint === 0xa ||
  codePoint === 0xd ||
  (codePoint >= 0x20 && codePoint <= 0xd7ff) ||
  (codePoint >= 0xe000 && codePoint <= 0xfffd) ||
  (codePoint >= 0x10000 && codePoint <= 0x10ffff);

const withoutXmlForbidden = (text: string): string =>
  Array.from(text)
    .filter((char) => isXmlChar(char.codePointAt(0) as number))
    .join("");

// Comment text is data: it reaches Asana only through these two, so a `<`, `>`
// or `&` anyone types arrives as that character rather than as markup.
export const escapeText = (text: string): string =>
  withoutXmlForbidden(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

export const escapeAttribute = (text: string): string =>
  escapeText(text).replace(/"/g, "&quot;");

// GitHub decodes the HTML entities in Markdown text when it renders. Asana does
// not (`&#39;` was stored as six characters), so they are decoded here and
// escaped again on the way out.
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  middot: "·",
  rarr: "→",
  larr: "←",
  times: "×",
  copy: "©",
};

const decodeEntities = (text: string): string =>
  text.replace(
    /&(#\d{1,7}|#x[0-9a-f]{1,6}|[a-z]+);/gi,
    (match: string, entity: string) => {
      if (entity.charAt(0) !== "#") return NAMED_ENTITIES[entity] ?? match;
      const isHex = entity.charAt(1).toLowerCase() === "x";
      const codePoint = parseInt(entity.slice(isHex ? 2 : 1), isHex ? 16 : 10);
      const isScalar =
        codePoint > 0 &&
        codePoint <= 0x10ffff &&
        (codePoint < 0xd800 || codePoint > 0xdfff);
      return isScalar ? String.fromCodePoint(codePoint) : match;
    }
  );

// The shortcodes GitHub turns into emoji that our bots and people write. An
// unknown name is left as typed.
const SHORTCODES: Record<string, string> = {
  white_check_mark: "✅",
  heavy_check_mark: "✔️",
  ballot_box_with_check: "☑️",
  x: "❌",
  heavy_multiplication_x: "✖️",
  warning: "⚠️",
  no_entry: "⛔",
  no_entry_sign: "🚫",
  stop_sign: "🛑",
  rotating_light: "🚨",
  exclamation: "❗",
  question: "❓",
  information_source: "ℹ️",
  red_circle: "🔴",
  orange_circle: "🟠",
  yellow_circle: "🟡",
  green_circle: "🟢",
  large_blue_circle: "🔵",
  blue_circle: "🔵",
  white_circle: "⚪",
  hourglass: "⌛",
  hourglass_flowing_sand: "⏳",
  rocket: "🚀",
  tada: "🎉",
  sparkles: "✨",
  fire: "🔥",
  bug: "🐛",
  bulb: "💡",
  eyes: "👀",
  mag: "🔍",
  lock: "🔒",
  shield: "🛡️",
  bow_and_arrow: "🏹",
  construction: "🚧",
  memo: "📝",
  pushpin: "📌",
  link: "🔗",
  star: "⭐",
  robot: "🤖",
  thumbsup: "👍",
  "+1": "👍",
  thumbsdown: "👎",
  "-1": "👎",
  heavy_minus_sign: "➖",
  arrow_right: "➡️",
};

// GitHub's handle grammar. The old `@\S+\w` read on through punctuation, so
// `@name's` looked up "name's" and found nobody.
const MENTION = /(^|[^\w@/.-])@([A-Za-z0-9][A-Za-z0-9-]{0,38})(?![\w-])/g;

const siteName = (url: string) => {
  const site = url.replace(/^[a-z]+:\/\/(www\.)?/i, "").split(/[./]/)[0];
  return `${site.charAt(0).toUpperCase()}${site.slice(1)}`;
};

const isWebUrl = (url: string) => /^https?:\/\/\S+$/i.test(url);

const anchor = (url: string, label: string) =>
  `<a href="${escapeAttribute(url)}"> 🔗 ${escapeText(label)} 🔗 </a>`;

const imageAnchor = (url: string) => anchor(url, "Image Attachment");

const asanaMention = (user: { asanaUrlId: string; asanaName: string }) =>
  `<a href="${MENTION_BASE_URL}${user.asanaUrlId}">@${escapeText(
    user.asanaName
  )}</a>`;

export const userMentionHTML = (githubName?: string) => {
  const userObj = utils.findUserByGithubName(githubName);
  if (!userObj) return escapeText(`@${githubName || "unknown"}`);
  return asanaMention(userObj);
};

export const isReplyComment = (body: string) => body.charAt(0) === ">";

type RenderContext = {
  mentionedAsanaIds: string[];
  // Raw HTML opens tags across sibling tokens, so these are counters the
  // inline renderer moves as it meets `<a>` and `<code>` and their closers.
  linkDepth: number;
  codeDepth: number;
  listDepth: number;
};

// Mentions and shortcodes are prose: never applied inside code, and never
// inside a link, where a mention would nest one anchor inside another.
const proseHTML = (raw: string, ctx: RenderContext): string => {
  const text = decodeEntities(raw);
  if (ctx.codeDepth > 0) return escapeText(text);
  const withEmoji = text.replace(
    /:([a-z0-9_+-]+):/g,
    (match: string, name: string) => SHORTCODES[name] ?? match
  );
  if (ctx.linkDepth > 0) return escapeText(withEmoji);

  let html = "";
  let last = 0;
  for (const match of withEmoji.matchAll(MENTION)) {
    const [whole, before, handle] = match;
    const user = utils.findUserByGithubName(handle);
    if (!user) continue;
    const start = (match.index ?? 0) + before.length;
    html += escapeText(withEmoji.slice(last, start)) + asanaMention(user);
    last = (match.index ?? 0) + whole.length;
    if (!ctx.mentionedAsanaIds.includes(user.asanaId))
      ctx.mentionedAsanaIds.push(user.asanaId);
  }
  return html + escapeText(withEmoji.slice(last));
};

const plainTextOf = (tokens: Token[] = []): string =>
  tokens
    .map((token: any) =>
      token.tokens
        ? plainTextOf(token.tokens)
        : decodeEntities(token.text ?? "")
    )
    .join("");

const INLINE_TAG_MAP: Record<string, string> = {
  b: "strong",
  strong: "strong",
  i: "em",
  em: "em",
  s: "s",
  del: "s",
  strike: "s",
  u: "u",
  ins: "u",
  code: "code",
  kbd: "code",
  samp: "code",
  tt: "code",
};

const RAW_TAG = /^<(\/?)\s*([a-zA-Z][\w-]*)([^>]*?)\/?\s*>$/;
const RAW_ATTRIBUTE = /\b([a-zA-Z-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;

const attributeOf = (attributes: string, name: string): string | undefined => {
  for (const match of attributes.matchAll(RAW_ATTRIBUTE)) {
    if (match[1].toLowerCase() === name)
      return decodeEntities(match[2] ?? match[3] ?? match[4]);
  }
  return undefined;
};

const closeTag = (tag: string, ctx: RenderContext): string => {
  if (tag === "a") ctx.linkDepth--;
  if (tag === "code") ctx.codeDepth--;
  return `</${tag}>`;
};

// One raw HTML tag as it appears in a comment. Tags Asana has an equivalent
// for are mapped and tracked on `open`, so every one the renderer opens it also
// closes; every other tag is dropped and the text around it kept.
const rawTagHTML = (
  tag: string,
  open: string[],
  ctx: RenderContext
): string => {
  if (tag.startsWith("<!--")) return "";
  const match = tag.match(RAW_TAG);
  if (!match) return escapeText(tag);
  const [, closing, rawName, attributes] = match;
  const name = rawName.toLowerCase();

  if (name === "br") return "\n";
  if (name === "img") {
    const src = attributeOf(attributes, "src");
    return src && isWebUrl(src) && ctx.linkDepth === 0 ? imageAnchor(src) : "";
  }

  const mapped = name === "a" ? "a" : INLINE_TAG_MAP[name];
  if (!mapped) return "";

  if (closing) {
    const at = open.lastIndexOf(mapped);
    if (at === -1) return "";
    let html = "";
    while (open.length > at) html += closeTag(open.pop() as string, ctx);
    return html;
  }

  if (mapped === "a") {
    const href = attributeOf(attributes, "href");
    if (!href || !isWebUrl(href) || ctx.linkDepth > 0) return "";
    open.push("a");
    ctx.linkDepth++;
    return `<a href="${escapeAttribute(href)}">`;
  }
  open.push(mapped);
  if (mapped === "code") ctx.codeDepth++;
  return `<${mapped}>`;
};

const RAW_HTML_PIECES = /<!--[\s\S]*?(?:-->|$)|<\/?[a-zA-Z][^<>]*>/g;
const LINE_ENDING_TAGS =
  /^(p|div|tr|li|h[1-6]|table|ul|ol|details|blockquote)$/;

// An HTML block (a `<details>`, a `<picture>`, a `<p align>`, a comment
// marker) is read as text with its tags mapped: GitHub does not render Markdown
// inside one either.
const rawHtmlBlockHTML = (raw: string, ctx: RenderContext): string => {
  const open: string[] = [];
  let html = "";
  let last = 0;
  for (const match of raw.matchAll(RAW_HTML_PIECES)) {
    const tag = match[0];
    html += proseHTML(raw.slice(last, match.index), ctx);
    last = (match.index ?? 0) + tag.length;
    const name = (
      tag.match(/^<\/?\s*([a-zA-Z][\w-]*)/)?.[1] ?? ""
    ).toLowerCase();
    const isClosing = tag.startsWith("</");
    if (name === "summary") {
      html += isClosing
        ? `${rawTagHTML("</strong>", open, ctx)}\n`
        : rawTagHTML("<strong>", open, ctx);
    } else if (LINE_ENDING_TAGS.test(name)) {
      if (isClosing) html += "\n";
    } else if (name === "td" || name === "th") {
      if (isClosing) html += " · ";
    } else {
      html += rawTagHTML(tag, open, ctx);
    }
  }
  html += proseHTML(raw.slice(last), ctx);
  while (open.length) html += closeTag(open.pop() as string, ctx);
  return html
    .replace(/ · (\n|$)/g, (_match: string, end: string) => end)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
};

const linkHTML = (token: Tokens.Link, ctx: RenderContext): string => {
  const label = plainTextOf(token.tokens);
  if (!isWebUrl(token.href) || ctx.linkDepth > 0) return proseHTML(label, ctx);
  // A markdown link keeps its own text; a bare url is named after its site
  // and loses a trailing slash, as it always has.
  if (token.raw.startsWith("[")) {
    return anchor(token.href, label || `${siteName(token.href)} Link`);
  }
  return anchor(token.href.replace(/\/$/, ""), `${siteName(token.href)} Link`);
};

const inlineHTML = (tokens: Token[] = [], ctx: RenderContext): string => {
  const open: string[] = [];
  let html = "";
  for (const token of tokens as any[]) {
    switch (token.type) {
      case "text":
        html += token.tokens
          ? inlineHTML(token.tokens, ctx)
          : proseHTML(token.text, ctx);
        break;
      case "escape":
        html += escapeText(token.text);
        break;
      case "strong":
        html += `<strong>${inlineHTML(token.tokens, ctx)}</strong>`;
        break;
      case "em":
        html += `<em>${inlineHTML(token.tokens, ctx)}</em>`;
        break;
      case "del":
        html += `<s>${inlineHTML(token.tokens, ctx)}</s>`;
        break;
      case "codespan":
        html += `<code>${escapeText(token.text)}</code>`;
        break;
      case "br":
        html += "\n";
        break;
      case "link":
        html += linkHTML(token, ctx);
        break;
      case "image":
        html +=
          isWebUrl(token.href) && ctx.linkDepth === 0
            ? imageAnchor(token.href)
            : proseHTML(token.text, ctx);
        break;
      case "html":
        html += rawTagHTML(token.text, open, ctx);
        break;
      default:
        html += proseHTML(token.raw ?? token.text ?? "", ctx);
    }
  }
  while (open.length) html += closeTag(open.pop() as string, ctx);
  return html;
};

const isBlockHTML = (html: string) =>
  BLOCK_TAGS.some(
    (tag) => html.startsWith(`<${tag}>`) || html.startsWith(`<${tag}/>`)
  );

// Block elements carry their own spacing in Asana, so only two runs of text
// next to each other need the blank line that separates paragraphs.
const joinBlocks = (blocks: string[]): string =>
  blocks.reduce((html, block, index) => {
    if (index === 0) return block;
    const previous = blocks[index - 1];
    const separator = isBlockHTML(previous) || isBlockHTML(block) ? "" : "\n\n";
    return html + separator + block;
  }, "");

// A story has no table tag: each row becomes one bullet that names its first
// cell and labels the rest with their column headers.
const tableHTML = (token: Tokens.Table, ctx: RenderContext): string => {
  const headers = token.header.map((cell) => plainTextOf(cell.tokens).trim());
  const rows = token.rows.map((row) => {
    const [first, ...rest] = row.map((cell) =>
      inlineHTML(cell.tokens, ctx).trim()
    );
    const labelled = rest
      .map((cell, index) => {
        const header = headers[index + 1];
        return header && cell ? `${escapeText(header)}: ${cell}` : cell;
      })
      .filter((cell) => cell !== "");
    const head = first ? `<strong>${first}</strong>` : "";
    const line = [head, labelled.join(" · ")].filter(Boolean).join(" — ");
    return `<li>${line}</li>`;
  });
  return rows.length ? `<ul>${rows.join("")}</ul>` : "";
};

const listItemHTML = (item: Tokens.ListItem, ctx: RenderContext): string => {
  ctx.listDepth++;
  const parts = blocksHTML(item.tokens, ctx);
  ctx.listDepth--;
  const marker = item.task ? (item.checked ? "☑ " : "☐ ") : "";
  return `<li>${marker}${joinBlocks(parts)}</li>`;
};

const blockHTML = (token: any, ctx: RenderContext): string => {
  switch (token.type) {
    case "heading": {
      const inner = inlineHTML(token.tokens, ctx);
      // Asana's comments have h1 and h2 only, and no heading inside a list.
      if (ctx.listDepth === 0 && token.depth === 1) return `<h1>${inner}</h1>`;
      if (ctx.listDepth === 0 && token.depth === 2) return `<h2>${inner}</h2>`;
      return `<strong>${inner}</strong>`;
    }
    case "paragraph":
      return inlineHTML(token.tokens, ctx);
    case "text":
      return token.tokens
        ? inlineHTML(token.tokens, ctx)
        : proseHTML(token.text, ctx);
    case "code":
      return `<pre>${escapeText(token.text)}</pre>`;
    case "blockquote":
      return `<blockquote>${joinBlocks(
        blocksHTML(token.tokens, ctx)
      )}</blockquote>`;
    case "list": {
      const tag = token.ordered ? "ol" : "ul";
      const items = token.items.map((item: Tokens.ListItem) =>
        listItemHTML(item, ctx)
      );
      return `<${tag}>${items.join("")}</${tag}>`;
    }
    case "table":
      return tableHTML(token, ctx);
    case "hr":
      return "<hr/>";
    case "html":
      return token.pre
        ? `<pre>${escapeText(
            decodeEntities(token.text.replace(RAW_HTML_PIECES, ""))
          )}</pre>`
        : rawHtmlBlockHTML(token.text, ctx);
    case "space":
    case "def":
      return "";
    default:
      return proseHTML(token.raw ?? token.text ?? "", ctx);
  }
};

const blocksHTML = (tokens: Token[] = [], ctx: RenderContext): string[] =>
  tokens.map((token) => blockHTML(token, ctx)).filter((html) => html !== "");

// Only what this file writes can get past here: tags from ALLOWED_TAGS, an
// href (the one attribute) on <a> alone, balanced and properly nested, every
// `&` starting an entity, and no character XML forbids.
export const isValidAsanaHtml = (html: string): boolean => {
  if (withoutXmlForbidden(html) !== html) return false;
  if (/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);)/i.test(html))
    return false;

  const TAG = /<(\/?)([a-z0-9]+)((?:\s+href="[^"<>]*")?)\s*(\/?)>/g;
  if (/[<>]/.test(html.replace(TAG, ""))) return false;

  const stack: string[] = [];
  for (const [, closing, name, attributes, selfClosing] of html.matchAll(TAG)) {
    if (!ALLOWED_TAGS.has(name)) return false;
    if (attributes && name !== "a") return false;
    if (name === "hr") {
      if (!selfClosing || closing) return false;
      continue;
    }
    if (selfClosing) return false;
    if (closing) {
      if (stack.pop() !== name) return false;
      continue;
    }
    const parent = stack[stack.length - 1];
    if (name === "a" && (!attributes || stack.includes("a"))) return false;
    if (name === "li" && parent !== "ul" && parent !== "ol") return false;
    stack.push(name);
  }
  return stack.length === 0;
};

const byteLength = (text: string) => Buffer.byteLength(text, "utf8");
const TRUNCATED_ROOM = BODY_BYTE_BUDGET - byteLength(TRUNCATED_NOTE) - 2;

// The fallback: the comment exactly as typed, every character escaped. The cut
// is made before escaping, so it can never split an entity.
const plainHTML = (raw: string): string => {
  if (byteLength(escapeText(raw)) <= BODY_BYTE_BUDGET) return escapeText(raw);
  let text = raw;
  while (byteLength(escapeText(text)) > TRUNCATED_ROOM)
    text = text.slice(0, Math.floor(text.length * 0.9));
  return `${escapeText(text)}\n\n${TRUNCATED_NOTE}`;
};

// Whole top-level blocks are kept until the next would cross the budget, so
// the cut never lands inside a tag.
const fitToBudget = (blocks: string[]): string | null => {
  const whole = joinBlocks(blocks);
  if (byteLength(whole) <= BODY_BYTE_BUDGET) return whole;
  const kept: string[] = [];
  for (const block of blocks) {
    if (byteLength(joinBlocks([...kept, block])) > TRUNCATED_ROOM) break;
    kept.push(block);
  }
  if (!kept.length) return null;
  return `${joinBlocks(kept)}\n\n${TRUNCATED_NOTE}`;
};

const withoutLeadingQuote = (raw: string): string => {
  const lines = raw.split("\n");
  while (lines.length && (lines[0].startsWith(">") || !lines[0].trim()))
    lines.shift();
  return lines.join("\n");
};

// A GitHub comment's Markdown as the inside of an Asana story's <body>. A reply
// drops the text it quotes, as GitHub's "Quote reply" puts it first. Whatever
// cannot be rendered within Asana's rules is posted as plain text instead, so
// a comment is never lost to its formatting.
export const markdownToAsana = (
  raw: string,
  options: { isReply?: boolean } = {}
): { body: string; mentionedAsanaIds: string[] } => {
  const ctx: RenderContext = {
    mentionedAsanaIds: [],
    linkDepth: 0,
    codeDepth: 0,
    listDepth: 0,
  };
  // The quote is cut from the text, not from the parsed tokens: Markdown reads
  // a reply typed on the line under the quote as part of the quote.
  const source = options.isReply ? withoutLeadingQuote(raw) : raw;
  const body = fitToBudget(blocksHTML(Lexer.lex(source, { gfm: true }), ctx));
  if (body !== null && isValidAsanaHtml(body)) {
    return { body, mentionedAsanaIds: ctx.mentionedAsanaIds };
  }
  console.warn(
    "Comment could not be rendered as Asana rich text; posting it as plain text"
  );
  return { body: plainHTML(source), mentionedAsanaIds: [] };
};
