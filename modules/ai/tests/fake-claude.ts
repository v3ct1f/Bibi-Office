/**
 * A stand-in for the Anthropic Messages API, for tests and local development (AI_API_BASE_URL=http://127.0.0.1:<port>).
 * Answers queued replies in order; when the queue is empty it makes a plausible answer from the request itself.
 */
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export interface Seen { path: string; headers: IncomingMessage["headers"]; body: Record<string, unknown> }
export type Reply =
  | { json: Record<string, unknown>; stop?: string; usage?: [number, number] }
  | { status: number; type: string; message: string }
  | { raw: string };

/**
 * The default answer, built from the request: lines like "Max: I'll order flour by 2026-11-27" become action items,
 * so local runs and browser tests get something realistic without a real key.
 */
function auto(body: Record<string, unknown>): Record<string, unknown> {
  const schema = (body.output_config as { format?: { schema?: { required?: string[] } } } | undefined)?.format?.schema;
  const req = schema?.required ?? [];
  if (req.includes("ok")) return { ok: "yes" };
  const user = String((body.messages as { content: string }[])[0]?.content ?? "");
  const inner = (user.split(/<(?:notes|conversation)>\n/)[1] ?? user).split(/\n<\/(?:notes|conversation)>/)[0] ?? "";
  const lines = inner.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("---"));
  const items = lines.filter((l) => /\b(I'll|I will|will)\b/i.test(l)).slice(0, 5).map((l) => {
    const m = l.match(/^([^:]{1,40}):\s*(.+)$/);
    const text = (m ? m[2]! : l).replace(/^(I'll|I will)\s+/i, "").replace(/\.$/, "");
    return { text: text.charAt(0).toUpperCase() + text.slice(1), owner: m ? m[1]! : "", due: l.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? "" };
  });
  const first = lines[0] ?? "the text";
  const all: Record<string, unknown> = {
    title: first.replace(/[.:]$/, "").slice(0, 60),
    summary: `The discussion covered: ${lines.slice(0, 3).join(" ").slice(0, 400)}`,
    keyPoints: lines.slice(0, 3).map((l) => l.slice(0, 120)),
    decisions: lines.filter((l) => /\b(agreed|decided)\b/i.test(l)).map((l) => l.slice(0, 160)),
    actionItems: items,
    openQuestions: lines.filter((l) => l.endsWith("?")).slice(0, 3),
    followUpSubject: `Recap: ${first.slice(0, 60)}`,
    followUpBody: `Hi all,\n\nThanks for your time. Here are the next steps:\n${items.map((i) => `- ${i.text}`).join("\n")}\n\nBest regards`,
    suggestedReply: "Hello,\n\nThank you for your message. We are looking into it and will get back to you today.\n\nKind regards",
  };
  return Object.fromEntries(req.map((k) => [k, all[k] ?? ""]));
}

export async function startFakeClaude(port = 0) {
  const queue: Reply[] = [];
  const seen: Seen[] = [];
  const server: Server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => { raw += c; });
    req.on("end", () => {
      const send = (status: number, payload: unknown) => {
        res.writeHead(status, { "content-type": "application/json", "request-id": `req_${seen.length}` });
        res.end(typeof payload === "string" ? payload : JSON.stringify(payload));
      };
      if (req.method === "GET" && req.url === "/") return send(200, { ok: true });
      const body = raw ? JSON.parse(raw) as Record<string, unknown> : {};
      seen.push({ path: req.url ?? "", headers: req.headers, body });
      if (!req.url?.startsWith("/v1/messages")) return send(404, { type: "error", error: { type: "not_found_error", message: "not found" } });
      const r = queue.shift() ?? { json: auto(body) };
      if ("status" in r) return send(r.status, { type: "error", error: { type: r.type, message: r.message } });
      const text = "raw" in r ? r.raw : JSON.stringify(r.json);
      const [i, o] = "json" in r && r.usage ? r.usage : [1200, 300];
      send(200, {
        id: `msg_${seen.length}`, type: "message", role: "assistant", model: body.model,
        content: [{ type: "text", text }], stop_reason: "json" in r && r.stop ? r.stop : "end_turn", stop_sequence: null,
        usage: { input_tokens: i, output_tokens: o },
      });
    });
  });
  await new Promise<void>((r) => server.listen(port, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    url, seen, queue,
    reply: (...r: Reply[]) => { queue.push(...r); },
    last: () => seen[seen.length - 1]!,
    stop: () => new Promise<void>((r) => server.close(() => r())),
  };
}
