import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@office/ui";
import { tt } from "./i18n.ts";
import type { MailMessage } from "./shared.tsx";

/**
 * Shows a received message. HTML mail has already been cleaned by the server; here it goes into a locked box as a second layer:
 * a sandboxed frame with no scripts, and its own content-security-policy that forbids everything except pictures (and from
 * the internet only after the reader asks). Links open in a new tab and never in the frame.
 */
export function MailBody({ m }: { m: MailMessage }) {
  const [images, setImages] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(120);

  const doc = useMemo(() => {
    if (!m.bodyHtml) return "";
    const html = images ? m.bodyHtml.replace(/ data-remote-src=/g, " src=") : m.bodyHtml;
    const csp = `default-src 'none'; img-src data:${images ? " https:" : ""}; style-src 'unsafe-inline'`;
    return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><base target="_blank">`
      + `<style>html,body{margin:0}body{font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;color:#1f2937;word-wrap:break-word;overflow-wrap:anywhere}`
      + `img{max-width:100%;height:auto}table{max-width:100%}a{color:#2563eb}blockquote{margin:.5em 0;padding-left:.8em;border-left:3px solid #d1d5db;color:#4b5563}pre{white-space:pre-wrap}</style>`
      + `</head><body>${html}</body></html>`;
  }, [m.bodyHtml, images]);

  const measure = () => {
    const d = frame.current?.contentDocument;
    if (d?.documentElement) setHeight(Math.min(Math.max(d.documentElement.scrollHeight, 40), 6000));
  };
  useEffect(() => { const t = setTimeout(measure, 60); return () => clearTimeout(t); }, [doc]);

  if (!m.bodyHtml) {
    return <div className="whitespace-pre-wrap break-words text-sm leading-6" data-testid="mail-body-text">{m.bodyText || ""}</div>;
  }
  return (
    <div data-testid="mail-body-html">
      {m.hasRemoteImages && !images && (
        <div className="mb-2 flex flex-wrap items-center gap-2 rounded-md border bg-muted/50 px-3 py-1.5 text-xs text-muted-foreground">
          <span>{tt("imagesBlocked")}</span>
          <Button size="sm" variant="outline" onClick={() => setImages(true)}>{tt("showImages")}</Button>
        </div>
      )}
      {/* allow-same-origin without allow-scripts: the page can measure the box, but nothing inside can run. */}
      <iframe
        ref={frame} title="Message" srcDoc={doc} sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        referrerPolicy="no-referrer" className="w-full border-0 bg-white" style={{ height }} onLoad={measure}
      />
    </div>
  );
}
