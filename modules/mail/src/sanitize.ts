/**
 * Makes received HTML mail safe to keep and show. Allow-list only: a tag, attribute or style that isn't listed is dropped.
 * Never lets through scripts, event handlers (onclick...), forms, frames, objects, `javascript:` links or styles that load things.
 * Pictures from the internet are NOT loaded (they tell the sender you opened the mail): they are kept as `data-remote-src`
 * and the reader chooses to show them. The app shows the result in a locked box (sandboxed iframe with its own
 * content-security-policy) as a second layer, so a mistake here still can't run a script.
 */

const ALLOWED_TAGS = new Set([
  "a", "abbr", "b", "blockquote", "br", "caption", "center", "cite", "code", "col", "colgroup", "dd", "div", "dl", "dt", "em", "font",
  "h1", "h2", "h3", "h4", "h5", "h6", "hr", "i", "img", "li", "ol", "p", "pre", "q", "s", "small", "span", "strike", "strong",
  "sub", "sup", "table", "tbody", "td", "tfoot", "th", "thead", "tr", "u", "ul",
]);
/** Tags removed together with everything inside them. */
const DROP_WITH_CONTENT = new Set([
  "script", "style", "iframe", "frame", "frameset", "object", "embed", "applet", "noscript", "template", "title", "head", "svg", "math",
  "textarea", "select", "option", "button", "form", "audio", "video", "canvas", "map", "xmp", "plaintext", "noembed", "noframes",
]);
const VOID = new Set(["br", "hr", "img", "col"]);

const SAFE_STYLE = new Set([
  "color", "background-color", "background", "font-family", "font-size", "font-weight", "font-style", "text-align", "text-decoration",
  "line-height", "vertical-align", "white-space", "width", "height", "max-width", "min-width", "margin", "margin-top", "margin-bottom",
  "margin-left", "margin-right", "padding", "padding-top", "padding-bottom", "padding-left", "padding-right", "border", "border-top",
  "border-bottom", "border-left", "border-right", "border-collapse", "border-spacing", "border-color", "border-width", "border-style",
  "list-style-type", "text-indent", "letter-spacing", "word-break",
]);

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/** Decodes the few entities that can hide a scheme (&#106;avascript:) before we look at a URL. */
function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);?/gi, (_, h: string) => String.fromCodePoint(Math.min(parseInt(h, 16), 0x10ffff)))
    .replace(/&#(\d+);?/g, (_, d: string) => String.fromCodePoint(Math.min(parseInt(d, 10), 0x10ffff)))
    .replace(/&colon;/gi, ":").replace(/&tab;/gi, "\t").replace(/&newline;/gi, "\n").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"');
}
// eslint-disable-next-line no-control-regex
const stripControl = (s: string) => s.replace(new RegExp("[\u0000-\u0020\u007f-\u009f\u200b-\u200f\u2028\u2029\ufeff]", "g"), "");

function safeUrl(raw: string, schemes: string[]): string | null {
  const v = stripControl(decodeEntities(raw));
  const m = /^([a-z][a-z0-9+.-]*):/i.exec(v);
  if (!m) return null; // relative links mean nothing in a mail
  return schemes.includes(m[1]!.toLowerCase()) ? decodeEntities(raw).trim() : null;
}

function cleanStyle(raw: string): string {
  const out: string[] = [];
  for (const decl of decodeEntities(raw).split(";")) {
    const i = decl.indexOf(":");
    if (i < 1) continue;
    const prop = decl.slice(0, i).trim().toLowerCase();
    const val = decl.slice(i + 1).trim();
    if (!SAFE_STYLE.has(prop) || !val || val.length > 200) continue;
    if (/url\s*\(|expression|javascript|behavior|binding|@import|\\|[<>{}]|\/\*/i.test(val)) continue;
    out.push(`${prop}:${val}`);
  }
  return out.join(";");
}

const ATTR_RE = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
function parseAttrs(src: string): Map<string, string> {
  const attrs = new Map<string, string>();
  for (const m of src.matchAll(ATTR_RE)) {
    const name = m[1]!.toLowerCase();
    if (!attrs.has(name)) attrs.set(name, m[2] ?? m[3] ?? m[4] ?? "");
  }
  return attrs;
}

const NUM = /^\d{1,4}%?$/;
function cleanAttrs(tag: string, attrs: Map<string, string>, state: { remote: boolean }): string {
  const out: string[] = [];
  const put = (k: string, v: string) => out.push(`${k}="${esc(v)}"`);
  for (const [name, value] of attrs) {
    if (name.startsWith("on")) continue;
    if (name === "style") { const s = cleanStyle(value); if (s) put("style", s); continue; }
    if (tag === "a" && name === "href") {
      const u = safeUrl(value, ["http", "https", "mailto", "tel"]);
      if (u) put("href", u);
      continue;
    }
    if (tag === "a" && name === "name") continue;
    if (tag === "img") {
      if (name === "src") {
        const v = stripControl(decodeEntities(value));
        if (/^data:image\/(png|jpe?g|gif|webp);base64,[a-z0-9+/=]+$/i.test(v) && v.length < 2_000_000) put("src", v);
        else if (/^cid:/i.test(v)) put("data-cid", v.slice(4));
        else if (/^https?:\/\//i.test(v)) { state.remote = true; put("data-remote-src", decodeEntities(value).trim()); }
        continue;
      }
      if (name === "alt" || name === "title") { put(name, value.slice(0, 300)); continue; }
      if ((name === "width" || name === "height") && NUM.test(value.trim())) { put(name, value.trim()); continue; }
      continue;
    }
    if (name === "title" || name === "dir" || name === "lang") { put(name, value.slice(0, 300)); continue; }
    if (name === "align" && /^(left|right|center|justify)$/i.test(value)) { put(name, value.toLowerCase()); continue; }
    if (name === "valign" && /^(top|middle|bottom|baseline)$/i.test(value)) { put(name, value.toLowerCase()); continue; }
    if ((name === "colspan" || name === "rowspan") && /^\d{1,3}$/.test(value.trim())) { put(name, value.trim()); continue; }
    if ((name === "width" || name === "height" || name === "cellpadding" || name === "cellspacing" || name === "border") && NUM.test(value.trim())) { put(name, value.trim()); continue; }
    if ((name === "color" || name === "bgcolor") && /^#?[0-9a-z]{3,20}$/i.test(value.trim())) { put(name, value.trim()); continue; }
    if (tag === "font" && (name === "size" || name === "face") && /^[\w ,+-]{1,60}$/.test(value)) { put(name, value); continue; }
  }
  if (tag === "a" && out.some((a) => a.startsWith("href="))) out.push('target="_blank"', 'rel="noopener noreferrer nofollow"');
  return out.length ? " " + out.join(" ") : "";
}

const TAG_RE = /<!--[\s\S]*?(?:-->|$)|<![^>]*>|<\?[^>]*>|<\/?([a-zA-Z][a-zA-Z0-9:-]*)((?:"[^"]*"|'[^']*'|[^'">])*)>?/g;

export interface Cleaned { html: string; hasRemoteImages: boolean }

export function sanitizeHtml(input: string): Cleaned {
  const src = input.length > 2_000_000 ? input.slice(0, 2_000_000) : input;
  const state = { remote: false };
  const out: string[] = [];
  const open: string[] = [];
  let pos = 0;
  const text = (s: string) => out.push(s.replace(/</g, "&lt;").replace(/>/g, "&gt;"));
  const re = new RegExp(TAG_RE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    text(src.slice(pos, m.index));
    pos = m.index! + m[0].length;
    const name = m[1]?.toLowerCase();
    if (!name) continue; // comment, doctype, processing instruction
    const closing = m[0].startsWith("</");
    if (DROP_WITH_CONTENT.has(name)) {
      if (!closing) {
        const rest = src.slice(pos);
        const end = new RegExp(`</${name}\\s*>`, "i").exec(rest);
        pos += end ? end.index + end[0].length : rest.length; // no closing tag: drop the rest of the message
        re.lastIndex = pos;
      }
      continue;
    }
    if (!ALLOWED_TAGS.has(name)) continue; // keep what's inside, lose the tag
    if (closing) {
      const i = open.lastIndexOf(name);
      if (i >= 0) { out.push(...open.splice(i).reverse().map((t) => `</${t}>`)); }
      continue;
    }
    out.push(`<${name}${cleanAttrs(name, parseAttrs(m[2] ?? ""), state)}>`);
    if (!VOID.has(name)) open.push(name);
  }
  text(src.slice(pos));
  out.push(...open.reverse().map((t) => `</${t}>`));
  return { html: out.join(""), hasRemoteImages: state.remote };
}

/** Plain text of an HTML body (for the preview line, search, and quoting in a reply). */
export function htmlToText(html: string): string {
  return decodeEntities(
    html.replace(/<(script|style|head|title)[\s\S]*?<\/\1\s*>/gi, " ")
      .replace(/<br\s*\/?>|<\/(p|div|li|tr|h[1-6]|blockquote)>/gi, "\n")
      .replace(/<[^>]*>/g, ""),
  ).replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ").trim();
}

/** Turns what someone typed in the editor (plain text) into simple safe HTML. */
export function textToHtml(text: string): string {
  const body = esc(text).replace(/\r\n?/g, "\n").replace(/\n/g, "<br>");
  return `<div>${body}</div>`;
}
