import { decodeHTMLStrict } from "entities";
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
// Every nesting the renderer can produce was posted to a live task. Kept as
// rich text: h1, h2, hr, nested lists, inline tags inside each other and inside
// headings, and h1/h2/pre/lists/hr/blockquote inside a blockquote. Answered
// with a 500 - which fails the run, so nothing posts - are a blockquote or hr
// anywhere inside a list item and any tag inside <pre>. The docs list fewer
// tags for stories; the live API is the authority.
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
// escaped again on the way out. Strict: as in CommonMark, only an entity that
// ends in `;` is one, so `?a=1&copy=2` keeps its `&copy`.
const decodeEntities = (text: string): string => decodeHTMLStrict(text);

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

// A GitHub alert (`> [!NOTE]`) opens with a quote but is the comment itself.
const ALERT = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*(?:\n|$)/i;
const ALERT_LABELS: Record<string, string> = {
  NOTE: "ℹ️ Note",
  TIP: "💡 Tip",
  IMPORTANT: "❗ Important",
  WARNING: "⚠️ Warning",
  CAUTION: "🛑 Caution",
};

export const isReplyComment = (body: string) =>
  body.charAt(0) === ">" && !ALERT.test(body.replace(/^>[ \t]?/, ""));

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
    .map((token: any) => {
      if (token.type === "html") return "";
      return token.tokens
        ? plainTextOf(token.tokens)
        : decodeEntities(token.text ?? "");
    })
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

// An attribute value may hold a `>`, so quoted values are read whole.
const RAW_TAG =
  /^<(\/?)\s*([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)\s*\/?\s*>$/;
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
    // Inside a link the image is the link's text, so it is named by its alt
    // text; dropping it left an anchor with nothing to click.
    if (ctx.linkDepth > 0)
      return escapeText(attributeOf(attributes, "alt") || "Image Attachment");
    const src = attributeOf(attributes, "src");
    return src && isWebUrl(src) ? imageAnchor(src) : "";
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

const RAW_HTML_PIECES =
  /<!--[\s\S]*?(?:-->|$)|<\/?[a-zA-Z](?:[^<>"']|"[^"]*"|'[^']*')*>/g;
const LINE_ENDING_TAGS = /^(p|div|tr|h[1-6]|table|details|blockquote)$/;

// An HTML block (a `<details>`, a `<picture>`, a `<p align>`, a comment
// marker) is read as text with its tags mapped: GitHub does not render Markdown
// inside one either.
const rawHtmlBlockHTML = (raw: string, ctx: RenderContext): string => {
  const open: string[] = [];
  // Raw lists become marked lines: a raw <li> could sit outside any list, and
  // Asana's <li> outside one, or a block inside one, is refused.
  const lists: { ordered: boolean; count: number }[] = [];
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
    } else if (name === "ul" || name === "ol") {
      if (isClosing) lists.pop();
      else lists.push({ ordered: name === "ol", count: 0 });
      html += "\n";
    } else if (name === "li") {
      const list = lists[lists.length - 1];
      if (!isClosing) {
        const marker = list?.ordered ? `${++list.count}. ` : "• ";
        html += `\n${"  ".repeat(Math.max(lists.length - 1, 0))}${marker}`;
      }
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
    .replace(/[ \t]*\n[ \t]*\n(?=[ \t]*(?:• |\d+\. ))/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
};

const linkHTML = (token: Tokens.Link, ctx: RenderContext): string => {
  const label = plainTextOf(token.tokens);
  // The lexer leaves entities in a destination as typed; escapeAttribute
  // escapes once, so they are decoded first.
  const href = decodeEntities(token.href);
  if (!isWebUrl(href) || ctx.linkDepth > 0) return proseHTML(label, ctx);
  // A markdown link keeps its own text; a bare url is named after its site
  // and loses a trailing slash, as it always has.
  if (token.raw.startsWith("[")) {
    return anchor(href, label || `${siteName(href)} Link`);
  }
  return anchor(href.replace(/\/$/, ""), `${siteName(href)} Link`);
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
      case "image": {
        const src = decodeEntities(token.href);
        html +=
          isWebUrl(src) && ctx.linkDepth === 0
            ? imageAnchor(src)
            : proseHTML(token.text || "Image Attachment", ctx);
        break;
      }
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
const separatorBetween = (previous: string, next: string) =>
  isBlockHTML(previous) || isBlockHTML(next) ? "" : "\n\n";

const joinBlocks = (blocks: string[]): string =>
  blocks.reduce(
    (html, block, index) =>
      index === 0
        ? block
        : html + separatorBetween(blocks[index - 1], block) + block,
    ""
  );

// A rendered block. A list, a table or a code block also keeps its parts, so a
// comment over Asana's size limit can be cut between two of them instead of
// losing the whole block.
type Block = { html: string; open?: string; parts?: string[]; close?: string };

const splittable = (open: string, parts: string[], close: string): Block => ({
  html: `${open}${parts.join("")}${close}`,
  open,
  parts,
  close,
});

// A story has no table tag: each row becomes one bullet that names its first
// cell and labels the rest with their column headers.
const tableBlock = (token: Tokens.Table, ctx: RenderContext): Block => {
  const headers = token.header.map((cell) => plainTextOf(cell.tokens).trim());
  if (!token.rows.length) {
    const line = headers.filter(Boolean).map(escapeText).join(" · ");
    return { html: line ? `<ul><li><strong>${line}</strong></li></ul>` : "" };
  }
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
  return splittable("<ul>", rows, "</ul>");
};

const listItemHTML = (
  item: Tokens.ListItem,
  number: number | null,
  ctx: RenderContext
): string => {
  ctx.listDepth++;
  const parts = blocksHTML(item.tokens, ctx);
  ctx.listDepth--;
  const marker = item.task ? (item.checked ? "☑ " : "☐ ") : "";
  const numbered = number === null ? "" : `${number}. `;
  return `<li>${numbered}${marker}${joinBlocks(parts)}</li>`;
};

// Asana's <ol> has no start attribute, so a list that does not count from 1 -
// the second half of one a paragraph or code block split - writes its own
// numbers rather than restarting at 1.
const listBlock = (token: Tokens.List, ctx: RenderContext): Block => {
  const start = typeof token.start === "number" ? token.start : 1;
  const ownNumbers = token.ordered && start !== 1;
  const tag = token.ordered && !ownNumbers ? "ol" : "ul";
  const items = token.items.map((item, index) =>
    listItemHTML(item, ownNumbers ? start + index : null, ctx)
  );
  return splittable(`<${tag}>`, items, `</${tag}>`);
};

const codeBlock = (text: string): Block => {
  const lines = text.split("\n");
  return splittable(
    "<pre>",
    lines.map((line, index) =>
      escapeText(index < lines.length - 1 ? `${line}\n` : line)
    ),
    "</pre>"
  );
};

const blockquoteHTML = (token: Tokens.Blockquote, ctx: RenderContext) => {
  const tokens = [...token.tokens] as any[];
  let label = "";
  const alert = tokens[0]?.type === "paragraph" && tokens[0].text.match(ALERT);
  if (alert) {
    label = `<strong>${ALERT_LABELS[alert[1].toUpperCase()]}</strong>`;
    const rest = tokens[0].text.slice(alert[0].length);
    tokens[0] = { ...tokens[0], tokens: Lexer.lexInline(rest) };
  }
  const inner = joinBlocks([label, ...blocksHTML(tokens, ctx)].filter(Boolean));
  // Asana answers a quote inside a list item with a 500, so there it is the
  // item's own text.
  return ctx.listDepth > 0 ? inner : `<blockquote>${inner}</blockquote>`;
};

const renderBlock = (token: any, ctx: RenderContext): Block => {
  switch (token.type) {
    case "heading": {
      const inner = inlineHTML(token.tokens, ctx);
      // Asana's comments have h1 and h2 only; inside a list a heading is the
      // item's bold line.
      if (ctx.listDepth === 0 && token.depth === 1)
        return { html: `<h1>${inner}</h1>` };
      if (ctx.listDepth === 0 && token.depth === 2)
        return { html: `<h2>${inner}</h2>` };
      return { html: `<strong>${inner}</strong>` };
    }
    case "paragraph":
      return { html: inlineHTML(token.tokens, ctx) };
    case "text":
      return {
        html: token.tokens
          ? inlineHTML(token.tokens, ctx)
          : proseHTML(token.text, ctx),
      };
    case "code":
      return codeBlock(token.text);
    case "blockquote":
      return { html: blockquoteHTML(token, ctx) };
    case "list":
      return listBlock(token, ctx);
    case "table":
      return tableBlock(token, ctx);
    case "hr":
      // A rule inside a list item is answered with a 500 as well.
      return { html: ctx.listDepth > 0 ? "———" : "<hr/>" };
    case "html":
      return token.pre
        ? codeBlock(decodeEntities(token.text.replace(RAW_HTML_PIECES, "")))
        : { html: rawHtmlBlockHTML(token.text, ctx) };
    case "space":
    case "def":
      return { html: "" };
    default:
      return { html: proseHTML(token.raw ?? token.text ?? "", ctx) };
  }
};

const renderBlocks = (tokens: Token[] = [], ctx: RenderContext): Block[] =>
  tokens
    .map((token) => renderBlock(token, ctx))
    .filter((block) => block.html !== "");

const blocksHTML = (tokens: Token[] = [], ctx: RenderContext): string[] =>
  renderBlocks(tokens, ctx).map((block) => block.html);

// Only what this file writes can get past here: tags from ALLOWED_TAGS, an
// href (the one attribute) on <a> alone, balanced and nested the way the live
// API accepts, every `&` starting an entity, and no character XML forbids.
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
      if (stack.includes("li") || stack.includes("pre")) return false;
      continue;
    }
    if (selfClosing) return false;
    if (closing) {
      if (stack.pop() !== name) return false;
      continue;
    }
    const parent = stack[stack.length - 1];
    if (stack.includes("pre")) return false;
    if (name === "a" && (!attributes || stack.includes("a"))) return false;
    if (name === "li" && parent !== "ul" && parent !== "ol") return false;
    if (name === "blockquote" && stack.includes("li")) return false;
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

// Top-level blocks are kept until the next would cross the budget, and that
// one is cut between its items, rows or lines when it has them - so the cut
// never lands inside a tag and one long list does not take the rest with it.
const fitToBudget = (blocks: Block[]): string | null => {
  const whole = joinBlocks(blocks.map((block) => block.html));
  if (byteLength(whole) <= BODY_BYTE_BUDGET) return whole;

  const kept: string[] = [];
  let used = 0;
  const cost = (html: string) =>
    byteLength(
      (kept.length ? separatorBetween(kept[kept.length - 1], html) : "") + html
    );
  for (const block of blocks) {
    if (used + cost(block.html) <= TRUNCATED_ROOM) {
      used += cost(block.html);
      kept.push(block.html);
      continue;
    }
    if (block.parts && block.open && block.close) {
      const parts: string[] = [];
      let partsBytes = byteLength(block.open + block.close);
      for (const part of block.parts) {
        if (used + partsBytes + byteLength(part) + 2 > TRUNCATED_ROOM) break;
        partsBytes += byteLength(part);
        parts.push(part);
      }
      if (parts.length)
        kept.push(`${block.open}${parts.join("")}${block.close}`);
    }
    break;
  }
  if (!kept.length) return null;
  return `${joinBlocks(kept)}\n\n${TRUNCATED_NOTE}`;
};

// An anchor left with no text - a raw <a> around something that renders to
// nothing - is named after its site, as a bare url is.
const withNamedEmptyLinks = (html: string): string =>
  html.replace(
    /<a href="([^"]*)">\s*<\/a>/g,
    (_match: string, href: string) =>
      `<a href="${href}"> 🔗 ${escapeText(
        `${siteName(decodeEntities(href))} Link`
      )} 🔗 </a>`
  );

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
  const fitted = fitToBudget(
    renderBlocks(Lexer.lex(source, { gfm: true }), ctx)
  );
  const body = fitted === null ? null : withNamedEmptyLinks(fitted);
  if (body !== null && isValidAsanaHtml(body)) {
    return { body, mentionedAsanaIds: ctx.mentionedAsanaIds };
  }
  console.warn(
    "Comment could not be rendered as Asana rich text; posting it as plain text"
  );
  // The mentions were found while rendering; the people they name still
  // follow the task when the comment itself goes out as plain text.
  return { body: plainHTML(source), mentionedAsanaIds: ctx.mentionedAsanaIds };
};
