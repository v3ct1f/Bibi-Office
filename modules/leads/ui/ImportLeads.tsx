import { useMemo, useRef, useState } from "react";
import { ArrowLeft, FileSpreadsheet, Upload } from "lucide-react";
import { Button, Card, Field, PageHeader, Select, Table, TBody, TD, TH, THead, TR, toast } from "@office/ui";
import { useModuleHost, type PageProps } from "@office/ui/module-ui";
import { guessMapping, IMPORT_FIELDS, parseCsv, type ImportField } from "./csv.ts";
import { errorMessage, SOURCES, type Source } from "./shared.tsx";

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_ROWS = 5000;
const CHUNK = 1000; // the server takes this many rows per request
interface Skipped { line: number; reason: "invalid" | "duplicate"; message: string }
interface Result { created: number; skipped: Skipped[] }

export function ImportLeads(_: PageProps) {
  const host = useModuleHost();
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [header, setHeader] = useState<string[]>([]);
  const [data, setData] = useState<string[][]>([]);
  const [map, setMap] = useState<Record<ImportField, number>>(() => guessMapping([]));
  const [source, setSource] = useState<Source>("other");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  async function pick(file: File | undefined) {
    setResult(null);
    if (!file) return;
    if (!/\.(csv|txt)$/i.test(file.name)) return toast.error("Choose a .csv file (in Excel: Save As, then CSV)");
    if (file.size > MAX_BYTES) return toast.error("That file is too big (5 MB at most)");
    const rows = parseCsv(await file.text());
    if (rows.length < 2) return toast.error("The file needs a header row and at least one lead");
    if (rows.length - 1 > MAX_ROWS) return toast.error(`Too many rows (${MAX_ROWS} at most). Split the file in parts.`);
    setFileName(file.name); setHeader(rows[0]!); setData(rows.slice(1)); setMap(guessMapping(rows[0]!));
  }

  const mapped = IMPORT_FIELDS.filter((f) => map[f.key] >= 0);
  const canReach = (["name", "firstName", "lastName", "email", "phone", "companyName"] as ImportField[]).some((k) => map[k] >= 0);
  const preview = useMemo(() => data.slice(0, 5), [data]);

  async function run() {
    setBusy(true);
    try {
      const all = data.map((cells, i) => ({
        line: i + 2,
        values: Object.fromEntries(IMPORT_FIELDS.flatMap((f) => (map[f.key] >= 0 ? [[f.key, (cells[map[f.key]] ?? "").trim()]] : []))),
      })).filter((r) => Object.values(r.values).some(Boolean));
      const total: Result = { created: 0, skipped: [] };
      for (let i = 0; i < all.length; i += CHUNK) {
        const r = await host.api.post<Result>("/leads/import", { source, rows: all.slice(i, i + CHUNK) });
        total.created += r.created; total.skipped.push(...r.skipped);
      }
      setResult(total);
      setData([]); setHeader([]); setFileName("");
      if (fileRef.current) fileRef.current.value = "";
      toast.success(`${total.created} lead${total.created === 1 ? "" : "s"} imported`);
    } catch (e) { toast.error(errorMessage(e)); }
    finally { setBusy(false); }
  }

  return (
    <>
      <PageHeader title="Import leads" description="Upload a spreadsheet saved as CSV. Check the columns, then import. People whose email is already a lead are skipped."
        actions={<Button variant="outline" onClick={() => host.navigate("/leads")}><ArrowLeft /> Back to leads</Button>} />
      {result && (
        <Card className="mb-4 p-4" role="status" aria-label="Import result">
          <p className="font-medium">{result.created} lead{result.created === 1 ? "" : "s"} imported{result.skipped.length ? `, ${result.skipped.length} skipped` : ""}.</p>
          {result.skipped.length > 0 && (
            <ul className="mt-2 max-h-64 list-disc overflow-auto pl-5 text-sm text-muted-foreground">
              {result.skipped.map((s) => <li key={s.line}>Row {s.line} ({s.reason === "duplicate" ? "duplicate" : "not valid"}): {s.message}</li>)}
            </ul>
          )}
          <Button className="mt-3" onClick={() => host.navigate("/leads")}>See leads</Button>
        </Card>
      )}
      <Card className="p-4">
        <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" aria-label="CSV file" onChange={(e) => void pick(e.target.files?.[0])} />
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" onClick={() => fileRef.current?.click()}><Upload /> {fileName ? "Choose another file" : "Choose a CSV file"}</Button>
          {fileName && <span className="flex items-center gap-1 text-sm text-muted-foreground"><FileSpreadsheet className="size-4" /> {fileName}: {data.length} rows</span>}
        </div>
        {!fileName && <p className="mt-3 text-sm text-muted-foreground">The first row must be the column titles. Up to {MAX_ROWS} rows and 5 MB.</p>}
        {fileName && (
          <>
            <h2 className="mt-6 text-sm font-semibold">Match your columns</h2>
            <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {IMPORT_FIELDS.map((f) => (
                <Field key={f.key} label={f.label}>
                  {(a) => (
                    <Select {...a} value={String(map[f.key])} onChange={(e) => setMap((m) => ({ ...m, [f.key]: Number(e.target.value) }))}>
                      <option value="-1">Do not import</option>
                      {header.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
                    </Select>
                  )}
                </Field>
              ))}
              <Field label="Source when the file does not say">
                {(a) => (
                  <Select {...a} value={source} onChange={(e) => setSource(e.target.value as Source)}>
                    {SOURCES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </Select>
                )}
              </Field>
            </div>
            <h2 className="mt-6 text-sm font-semibold">Preview (first {preview.length} rows)</h2>
            {mapped.length ? (
              <div className="mt-2 overflow-x-auto">
                <Table aria-label="Preview">
                  <THead><TR>{mapped.map((f) => <TH key={f.key}>{f.label}</TH>)}</TR></THead>
                  <TBody>{preview.map((r, i) => <TR key={i}>{mapped.map((f) => <TD key={f.key}>{r[map[f.key]] ?? ""}</TD>)}</TR>)}</TBody>
                </Table>
              </div>
            ) : <p className="mt-2 text-sm text-muted-foreground">Pick at least one column above.</p>}
            {!canReach && mapped.length > 0 && <p className="mt-2 text-sm text-destructive">Match at least a name, email, phone or company column.</p>}
            <Button className="mt-4" disabled={busy || !canReach} onClick={() => void run()}>{busy ? "Importing…" : `Import ${data.length} rows`}</Button>
          </>
        )}
      </Card>
    </>
  );
}
