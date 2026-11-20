/**
 * Reads meeting notes and transcripts in the browser, so only plain text is sent to the server.
 * Supports .txt/.md, subtitle files from Zoom/Teams/Meet (.vtt, .srt) and Word (.docx).
 */
import { unzipSync, strFromU8 } from "fflate";

export const ACCEPT = ".txt,.md,.vtt,.srt,.docx,text/plain,text/markdown,text/vtt,application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const MAX_FILE_BYTES = 15 * 1024 * 1024;

export class TranscriptError extends Error {}

const TIME = /^\s*(\d{1,2}:)?\d{1,2}:\d{2}[.,]\d{1,3}\s*-->\s*(\d{1,2}:)?\d{1,2}:\d{2}[.,]\d{1,3}.*$/;

/**
 * Subtitle cues -> "Speaker: text" lines. Repeated cues from the same speaker are joined,
 * and Teams/Zoom voice tags (<v Anna Smith>) become the speaker name.
 */
export function subtitlesToText(src: string): string {
  const lines = src.replace(/^﻿/, "").replace(/\r\n?/g, "\n").split("\n");
  const cues: { who: string | null; text: string }[] = [];
  let buf: string[] = [];
  let inNote = false;
  const flush = () => {
    if (!buf.length) return;
    let text = buf.join(" ").trim();
    let who: string | null = null;
    const v = text.match(/^<v(?:\.[^ >]*)?\s+([^>]+)>/i);
    if (v) { who = v[1]!.trim(); }
    text = text.replace(/<\/?[^>]+>/g, "").trim();
    const named = !who && text.match(/^([A-ZÀ-Ý][\p{L}.'-]*(?: [\p{L}.'-]+){0,3}):\s+(.+)$/u);
    if (named) { who = named[1]!; text = named[2]!; }
    if (text) cues.push({ who, text });
    buf = [];
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (inNote) { if (!line) inNote = false; continue; }
    if (/^WEBVTT/.test(line) || /^(STYLE|REGION)\b/.test(line)) { inNote = true; continue; }
    if (/^NOTE\b/.test(line)) { inNote = true; continue; }
    if (!line) { flush(); continue; }
    if (TIME.test(line)) { flush(); continue; }
    if (/^\d+$/.test(line) && !buf.length) continue; // SRT cue number
    if (/^[0-9a-f-]{8,}(\/\d+-\d+)?$/i.test(line) && !buf.length) continue; // Teams cue id
    buf.push(line);
  }
  flush();
  const out: string[] = [];
  for (const c of cues) {
    const last = out.length ? out[out.length - 1]! : null;
    const prefix = c.who ? `${c.who}: ` : "";
    if (last !== null && c.who && last.startsWith(prefix)) out[out.length - 1] = `${last} ${c.text}`;
    else if (last !== null && !c.who && !/^[^:]{1,60}: /.test(last)) out[out.length - 1] = `${last} ${c.text}`;
    else out.push(prefix + c.text);
  }
  return out.join("\n");
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const decode = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) =>
    e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENTITIES[e] ?? m);

/** The text of a Word document: one line per paragraph, tabs and line breaks kept. */
export function docxToText(bytes: Uint8Array): string {
  let files: Record<string, Uint8Array>;
  try { files = unzipSync(bytes, { filter: (f) => f.name === "word/document.xml" }); } catch { throw new TranscriptError("This Word file couldn't be opened. Save it again as .docx, or copy and paste the text."); }
  const xml = files["word/document.xml"];
  if (!xml) throw new TranscriptError("This doesn't look like a Word (.docx) file.");
  const body = strFromU8(xml);
  const paras = body.split(/<\/w:p>/);
  const piece = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\/>|<w:(?:br|cr)\/>/g;
  return paras.map((p) => {
    let line = "";
    for (const m of p.matchAll(piece)) line += m[1] !== undefined ? decode(m[1]) : m[0].startsWith("<w:tab") ? "\t" : "\n";
    return line.replace(/[ \t]+$/g, "");
  }).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Picks the reader by file name. */
export function fileToText(name: string, bytes: Uint8Array): string {
  if (bytes.length > MAX_FILE_BYTES) throw new TranscriptError("This file is too big (at most 15 MB).");
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (ext === "docx") return docxToText(bytes);
  if (ext === "doc") throw new TranscriptError("Old Word files (.doc) can't be read. Save it as .docx, or copy and paste the text.");
  if (!["txt", "md", "vtt", "srt"].includes(ext)) throw new TranscriptError("Use a .txt, .vtt, .srt or .docx file, or paste the text.");
  const text = new TextDecoder("utf-8").decode(bytes);
  if (text.includes("\u0000")) throw new TranscriptError("This file isn't plain text.");
  return ext === "vtt" || ext === "srt" || /^WEBVTT/.test(text.replace(/^﻿/, "")) ? subtitlesToText(text) : text.replace(/^﻿/, "").replace(/\r\n?/g, "\n").trim();
}
