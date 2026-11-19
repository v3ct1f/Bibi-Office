// A local stand-in for the Claude Messages API, used by tests and E2E via ANTHROPIC_BASE_URL. No real API calls.
// Behaviour by document text: contains "REFUSE" → stop_reason "refusal"; key "sk-ant-bad…" → 401; otherwise a fixed structured summary.
import { createServer, type Server } from "node:http";

export interface FakeCall { apiKey: string | undefined; beta: string | undefined; body: { model: string; max_tokens: number; system?: string; messages: { content: string }[]; output_config?: unknown; fallbacks?: unknown } }
export const SAMPLE = {
  title: "Weekly ops sync",
  tldr: "The team agreed to switch flour suppliers in March and to hire a weekend baker.",
  keyPoints: ["Flour costs rose 12% this quarter", "Saturday queues are over 20 minutes"],
  decisions: ["Switch to Mill & Co. from March 1"],
  actionItems: [
    { task: "Sign the Mill & Co. supply contract", owner: "Grace", due: "2027-02-20" },
    { task: "Post the weekend baker job ad", owner: null, due: null },
  ],
  openQuestions: ["Do we keep the old supplier for rye?"],
};

export async function startFakeClaude(port = 0): Promise<{ url: string; calls: FakeCall[]; close(): Promise<void>; server: Server }> {
  const calls: FakeCall[] = [];
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c: Buffer) => (raw += c.toString()));
    req.on("end", () => {
      const send = (status: number, body: unknown) => { res.writeHead(status, { "content-type": "application/json", "request-id": "req_fake" }); res.end(JSON.stringify(body)); };
      if (req.method !== "POST" || !req.url?.startsWith("/v1/messages")) return send(404, { type: "error", error: { type: "not_found_error", message: "Not found" } });
      const body = JSON.parse(raw) as FakeCall["body"];
      const apiKey = (req.headers["x-api-key"] as string | undefined) ?? req.headers.authorization?.replace(/^Bearer /, "");
      calls.push({ apiKey, beta: req.headers["anthropic-beta"] as string | undefined, body });
      if (!apiKey || apiKey.startsWith("sk-ant-bad")) return send(401, { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } });
      const text = body.messages.map((m) => m.content).join("\n");
      const usage = { input_tokens: Math.ceil(text.length / 4) + 300, output_tokens: 250 };
      const base = { id: "msg_fake", type: "message", role: "assistant", model: body.model, stop_sequence: null, usage };
      if (text.includes("REFUSE")) return send(200, { ...base, content: [], stop_reason: "refusal" });
      return send(200, { ...base, content: [{ type: "text", text: JSON.stringify(SAMPLE) }], stop_reason: "end_turn" });
    });
  });
  await new Promise<void>((r) => server.listen(port, "127.0.0.1", r));
  const addr = server.address() as { port: number };
  return { url: `http://127.0.0.1:${addr.port}`, calls, server, close: () => new Promise((r) => server.close(() => r())) };
}
