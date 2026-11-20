import { useEffect, useRef, useState, type ReactNode } from "react";
import { Skeleton } from "@office/ui";

type PdfJs = typeof import("pdfjs-dist");
let pdfjs: Promise<PdfJs> | null = null;
/** pdf.js is loaded on first use (it's big), with its worker served by our own build. */
function loadPdfJs(): Promise<PdfJs> {
  pdfjs ??= Promise.all([import("pdfjs-dist"), import("pdfjs-dist/build/pdf.worker.min.mjs?url")]).then(([lib, worker]) => {
    lib.GlobalWorkerOptions.workerSrc = worker.default;
    return lib;
  });
  return pdfjs;
}

interface PageSize { width: number; height: number }

/**
 * Shows every page of a PDF at the width of its container. `overlay(page)` is drawn on top of each page
 * (position children with percentages); `onPageClick` gets the click as fractions of the page.
 */
export function PdfPages({ data, overlay, onPageClick, label = "Document" }: {
  data: Uint8Array; overlay?: (page: number) => ReactNode; onPageClick?: (page: number, x: number, y: number) => void; label?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [doc, setDoc] = useState<{ pages: PageSize[]; get: (n: number) => Promise<import("pdfjs-dist").PDFPageProxy> } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e!.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    let destroy: (() => void) | null = null;
    setDoc(null); setError(null);
    void (async () => {
      try {
        const lib = await loadPdfJs();
        const task = lib.getDocument({ data: data.slice() });
        destroy = () => void task.destroy();
        const pdf = await task.promise;
        const pages: PageSize[] = [];
        for (let i = 1; i <= pdf.numPages; i++) {
          const v = (await pdf.getPage(i)).getViewport({ scale: 1 });
          pages.push({ width: v.width, height: v.height });
        }
        if (!cancelled) setDoc({ pages, get: (n) => pdf.getPage(n) });
      } catch {
        if (!cancelled) setError("This PDF can't be shown here. You can still download it.");
      }
    })();
    return () => { cancelled = true; destroy?.(); };
  }, [data]);

  return (
    <div ref={box} className="grid gap-4" role="document" aria-label={label}>
      {error ? <p className="rounded-md border p-4 text-sm text-muted-foreground">{error}</p>
        : !doc || !width ? <Skeleton className="aspect-[1/1.414] w-full" />
        : doc.pages.map((p, i) => (
          <Page key={i} n={i + 1} size={p} width={width} get={doc.get} overlay={overlay} onClick={onPageClick} />
        ))}
    </div>
  );
}

function Page({ n, size, width, get, overlay, onClick }: {
  n: number; size: PageSize; width: number; get: (n: number) => Promise<import("pdfjs-dist").PDFPageProxy>;
  overlay?: (page: number) => ReactNode; onClick?: (page: number, x: number, y: number) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const height = Math.round((width * size.height) / size.width);
  useEffect(() => {
    let task: { cancel(): void; promise: Promise<void> } | null = null;
    let alive = true;
    void get(n).then((page) => {
      const c = canvas.current;
      if (!c || !alive) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const viewport = page.getViewport({ scale: (width / size.width) * dpr });
      c.width = Math.floor(viewport.width); c.height = Math.floor(viewport.height);
      task = page.render({ canvas: c, viewport });
      task.promise.catch(() => {});
    });
    return () => { alive = false; task?.cancel(); };
  }, [n, width, size.width, get]);
  return (
    <div className="relative mx-auto overflow-hidden rounded-sm border bg-white shadow-sm" style={{ width, height }} data-page={n} aria-label={`Page ${n}`} role="group"
      onClick={onClick ? (e) => {
        if (e.target !== e.currentTarget && !(e.target as HTMLElement).dataset.pageSurface) return;
        const r = e.currentTarget.getBoundingClientRect();
        onClick(n, (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
      } : undefined}>
      <canvas ref={canvas} data-page-surface="1" className="absolute inset-0 size-full" />
      {overlay?.(n)}
    </div>
  );
}
