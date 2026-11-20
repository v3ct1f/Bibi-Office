import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Calendar, Contact, PenLine, Send, Trash2, Type, User, UserPlus, X } from "lucide-react";
import { Button, Card, Field, Input, Select, Textarea, toast } from "@office/ui";
import { useModuleHost } from "@office/ui/module-ui";
import { PdfPages } from "./PdfPages.tsx";
import {
  EMAIL_RE, FIELD_LABEL, SIGNER_COLORS, b64ToBytes, errorMessage, today, useLoad,
  type Config, type DocDetail, type FieldKind, type TeamPerson,
} from "./shared.tsx";

export interface SignerDraft { name: string; email: string; userId: string | null; contactId: string | null }
interface FieldDraft { key: string; signer: number; kind: FieldKind; page: number; x: number; y: number; w: number; h: number; required: boolean; label: string | null }

interface ContactRow { id: string; firstName: string | null; lastName: string | null; email: string | null; companyId: string | null }
export const contactName = (c: ContactRow) => [c.firstName, c.lastName].filter(Boolean).join(" ") || c.email || "Contact";

// ── Signers ──────────────────────────────────────────────────────────────────
/** Pick signers from the team, from Contacts, or type anyone in. */
export function SignerList({ value, onChange, ordered }: { value: SignerDraft[]; onChange: (v: SignerDraft[]) => void; ordered?: boolean }) {
  const host = useModuleHost();
  const team = useLoad(() => host.api.get<TeamPerson[]>("/people"), [host]);
  const canContacts = host.can("core:contacts.read");
  const [adding, setAdding] = useState<"team" | "contact" | null>(null);
  const [q, setQ] = useState("");
  const contacts = useLoad(
    () => (adding === "contact" ? host.core.get<{ data: ContactRow[] }>("/contacts", { q: q.trim() || undefined, limit: 8 }).then((r) => r.data) : Promise.resolve([] as ContactRow[])),
    [host, adding, q],
  );
  const set = (i: number, patch: Partial<SignerDraft>) => onChange(value.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const add = (s: SignerDraft) => {
    if (value.length >= 10) { toast.error("At most 10 signers"); return; }
    if (s.email && value.some((x) => x.email.toLowerCase() === s.email.toLowerCase())) { toast.error(`${s.email} is already in the list`); return; }
    onChange([...value, s]); setAdding(null); setQ("");
  };
  const move = (i: number, d: -1 | 1) => { const v = [...value]; const [x] = v.splice(i, 1); v.splice(i + d, 0, x!); onChange(v); };
  return (
    <div className="grid gap-2">
      <ol aria-label="Signers" className="grid gap-2">
        {value.map((s, i) => (
          <li key={i} aria-label={`Signer ${i + 1}`} className="grid gap-2 rounded-md border p-2" style={{ borderLeft: `4px solid ${SIGNER_COLORS[i % SIGNER_COLORS.length]}` }}>
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <span className="font-medium">{ordered ? `Signs ${i + 1}${i === 0 ? "st" : i === 1 ? "nd" : i === 2 ? "rd" : "th"}` : `Signer ${i + 1}`}</span>
              {s.userId && <span className="rounded bg-muted px-1">Team</span>}
              {s.contactId && <span className="rounded bg-muted px-1">Contact</span>}
              <span className="ml-auto flex">
                {ordered && i > 0 && <Button size="icon" variant="ghost" className="size-7" aria-label={`Move ${s.name || "signer"} up`} onClick={() => move(i, -1)}><ArrowUp /></Button>}
                {ordered && i < value.length - 1 && <Button size="icon" variant="ghost" className="size-7" aria-label={`Move ${s.name || "signer"} down`} onClick={() => move(i, 1)}><ArrowDown /></Button>}
                <Button size="icon" variant="ghost" className="size-7" aria-label={`Remove ${s.name || "signer"}`} onClick={() => onChange(value.filter((_, j) => j !== i))}><X /></Button>
              </span>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <Input aria-label={`Signer ${i + 1} name`} placeholder="Name" value={s.name} onChange={(e) => set(i, { name: e.target.value })} />
              <Input aria-label={`Signer ${i + 1} email`} placeholder="Email" type="email" value={s.email} aria-invalid={!!s.email && !EMAIL_RE.test(s.email.trim())}
                onChange={(e) => set(i, { email: e.target.value })} />
            </div>
          </li>
        ))}
      </ol>
      {!value.length && <p className="text-sm text-muted-foreground">No signers yet.</p>}
      {adding === "team" ? (
        <div className="flex gap-2">
          <Select aria-label="Team member" className="flex-1" value="" onChange={(e) => {
            const p = team.data?.find((x) => x.userId === e.target.value);
            if (p) add({ name: p.name, email: p.email, userId: p.userId, contactId: null });
          }}>
            <option value="">Pick a team member…</option>
            {team.data?.map((p) => <option key={p.userId} value={p.userId}>{p.name} ({p.email})</option>)}
          </Select>
          <Button variant="ghost" onClick={() => setAdding(null)}>Cancel</Button>
        </div>
      ) : adding === "contact" ? (
        <div className="grid gap-1 rounded-md border p-2">
          <div className="flex gap-2">
            <Input aria-label="Search contacts" autoFocus placeholder="Search contacts…" value={q} onChange={(e) => setQ(e.target.value)} />
            <Button variant="ghost" onClick={() => setAdding(null)}>Cancel</Button>
          </div>
          <ul aria-label="Contacts found" className="grid">
            {contacts.data?.map((c) => (
              <li key={c.id}>
                <button type="button" className="w-full rounded px-2 py-1.5 text-left text-sm hover:bg-accent disabled:opacity-50" disabled={!c.email}
                  onClick={() => add({ name: contactName(c), email: c.email ?? "", userId: null, contactId: c.id })}>
                  {contactName(c)} <span className="text-muted-foreground">{c.email ?? "no email"}</span>
                </button>
              </li>
            ))}
            {contacts.data && !contacts.data.length && <li className="px-2 py-1.5 text-sm text-muted-foreground">No contacts found</li>}
          </ul>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => setAdding("team")}><User /> Team member</Button>
          {canContacts && <Button size="sm" variant="outline" onClick={() => setAdding("contact")}><Contact /> From contacts</Button>}
          <Button size="sm" variant="outline" onClick={() => add({ name: "", email: "", userId: null, contactId: null })}><UserPlus /> Someone else</Button>
        </div>
      )}
    </div>
  );
}
export function signerProblem(list: SignerDraft[]): string | null {
  for (const [i, s] of list.entries()) {
    if (!s.name.trim()) return `Signer ${i + 1} needs a name`;
    if (!EMAIL_RE.test(s.email.trim())) return `Check the email address of ${s.name || `signer ${i + 1}`}`;
  }
  return null;
}
export const cleanSigners = (list: SignerDraft[]) => list.map((s) => ({ name: s.name.trim(), email: s.email.trim().toLowerCase(), userId: s.userId, contactId: s.contactId }));

// ── Field editor ─────────────────────────────────────────────────────────────
const SIZE: Record<FieldKind, { w: number; h: number }> = {
  signature: { w: 0.26, h: 0.06 }, initials: { w: 0.09, h: 0.05 }, date: { w: 0.16, h: 0.028 }, name: { w: 0.24, h: 0.028 }, text: { w: 0.26, h: 0.028 },
};
const TOOLS: { kind: FieldKind; icon: React.ReactNode }[] = [
  { kind: "signature", icon: <PenLine /> }, { kind: "initials", icon: <PenLine /> }, { kind: "name", icon: <User /> },
  { kind: "date", icon: <Calendar /> }, { kind: "text", icon: <Type /> },
];
let seq = 0;
const key = () => `f${++seq}`;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Draft setup: signers, boxes on the pages, and the request's options; saves, then sends. */
export function RequestEditor({ doc, cfg, onChanged, onSent }: { doc: DocDetail; cfg: Config; onChanged: (d: DocDetail) => void; onSent: (d: DocDetail) => void }) {
  const host = useModuleHost();
  const file = useLoad(() => host.api.get<{ data: string }>(`/documents/${doc.id}/file`).then((f) => b64ToBytes(f.data)), [host, doc.id]);
  const team = useLoad(() => host.api.get<TeamPerson[]>("/people"), [host]);
  const [signers, setSigners] = useState<SignerDraft[]>(() => doc.signers.map((s) => ({ name: s.name, email: s.email, userId: s.userId, contactId: s.contactId })));
  const [list, setList] = useState<FieldDraft[]>(() => doc.fields.map((f) => ({
    key: key(), signer: Math.max(0, doc.signers.findIndex((s) => s.id === f.signerId)), kind: f.kind, page: f.page, x: f.x, y: f.y, w: f.w, h: f.h, required: f.required, label: f.label,
  })));
  const [opts, setOpts] = useState({
    message: doc.message ?? "", ordered: doc.ordered, expiresOn: doc.expiresOn ?? "", remindEveryDays: doc.remindEveryDays, employeeId: doc.employeeId ?? "",
  });
  const [active, setActive] = useState(0);
  const [tool, setTool] = useState<FieldKind | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState<"save" | "send" | null>(null);
  const [dirty, setDirty] = useState(false);
  const touch = () => setDirty(true);

  // Removing a signer removes their boxes and shifts the rest.
  const changeSigners = (next: SignerDraft[]) => {
    if (next.length < signers.length) {
      const removed = signers.findIndex((s, i) => next[i] !== s);
      const at = removed === -1 ? signers.length - 1 : removed;
      setList((l) => l.filter((f) => f.signer !== at).map((f) => (f.signer > at ? { ...f, signer: f.signer - 1 } : f)));
    } else if (next.length === signers.length && next.some((s, i) => s !== signers[i] && signers.indexOf(s) !== -1)) {
      // Re-ordered: keep boxes with their signer.
      const map = signers.map((s) => next.indexOf(s));
      setList((l) => l.map((f) => ({ ...f, signer: map[f.signer] ?? f.signer })));
    }
    setSigners(next);
    setActive((a) => Math.min(a, Math.max(0, next.length - 1)));
    touch();
  };

  const place = (page: number, x: number, y: number) => {
    if (!tool) { setSelected(null); return; }
    if (!signers.length) { toast.error("Add a signer first"); return; }
    const s = SIZE[tool];
    const f: FieldDraft = { key: key(), signer: active, kind: tool, page, w: s.w, h: s.h, x: clamp(x - s.w / 2, 0, 1 - s.w), y: clamp(y - s.h / 2, 0, 1 - s.h), required: true, label: tool === "text" ? "" : null };
    setList((l) => [...l, f]);
    setSelected(f.key);
    touch();
  };
  const update = (k: string, patch: Partial<FieldDraft>) => { setList((l) => l.map((f) => (f.key === k ? { ...f, ...patch } : f))); touch(); };
  const remove = (k: string) => { setList((l) => l.filter((f) => f.key !== k)); setSelected(null); touch(); };
  const sel = list.find((f) => f.key === selected) ?? null;

  async function save(): Promise<DocDetail | null> {
    const problem = signerProblem(signers);
    if (problem) { toast.error(problem); return null; }
    if (opts.expiresOn && opts.expiresOn < today()) { toast.error("Pick an expiry date in the future"); return null; }
    await host.api.patch<DocDetail>(`/documents/${doc.id}`, {
      message: opts.message.trim() || null, ordered: opts.ordered, expiresOn: opts.expiresOn || null,
      remindEveryDays: Number(opts.remindEveryDays) || 0, employeeId: opts.employeeId || null,
    });
    const d = await host.api.put<DocDetail>(`/documents/${doc.id}/setup`, {
      signers: cleanSigners(signers),
      fields: list.map((f) => ({ signer: f.signer, kind: f.kind, page: f.page, x: f.x, y: f.y, w: f.w, h: f.h, required: f.required, label: f.kind === "text" ? f.label?.trim() || null : null })),
    });
    setDirty(false);
    return d;
  }
  async function onSave() {
    setBusy("save");
    try { const d = await save(); if (d) { toast.success("Draft saved"); onChanged(d); } }
    catch (e) { toast.error(errorMessage(e)); } finally { setBusy(null); }
  }
  async function onSend() {
    const missing = signers.findIndex((_, i) => !list.some((f) => f.signer === i && (f.kind === "signature" || f.kind === "initials")));
    if (!signers.length) { toast.error("Add at least one signer"); return; }
    if (missing !== -1) { toast.error(`Add a signature box for ${signers[missing]!.name || `signer ${missing + 1}`}`); setActive(missing); setTool("signature"); return; }
    setBusy("send");
    try {
      const d = await save();
      if (!d) return;
      const sent = await host.api.post<DocDetail>(`/documents/${doc.id}/send`, { appUrl: window.location.origin, companyName: host.tenant.name });
      onSent(sent);
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(null); }
  }

  // Leaving with unsaved changes
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  const color = (i: number) => SIGNER_COLORS[i % SIGNER_COLORS.length]!;
  const name = (i: number) => signers[i]?.name.trim() || `Signer ${i + 1}`;
  const counts = useMemo(() => signers.map((_, i) => list.filter((f) => f.signer === i).length), [signers, list]);

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="grid gap-3">
        <Card className="sticky top-2 z-10 flex flex-wrap items-center gap-2 p-2" role="toolbar" aria-label="Boxes">
          <span className="px-1 text-sm text-muted-foreground">Add for</span>
          <Select aria-label="Boxes for" className="h-8 w-44" value={String(active)} onChange={(e) => setActive(Number(e.target.value))} disabled={!signers.length}>
            {signers.length ? signers.map((_, i) => <option key={i} value={i}>{name(i)}</option>) : <option>Add a signer first</option>}
          </Select>
          {TOOLS.map((t) => (
            <Button key={t.kind} size="sm" variant={tool === t.kind ? "default" : "outline"} aria-pressed={tool === t.kind}
              onClick={() => setTool(tool === t.kind ? null : t.kind)} disabled={!signers.length}>{t.icon} {FIELD_LABEL[t.kind]}</Button>
          ))}
          <span className="basis-full px-1 text-xs text-muted-foreground">
            {tool ? `Click on a page to place a ${FIELD_LABEL[tool].toLowerCase()} box for ${name(active)}. Drag boxes to move them.` : "Pick a box type, then click on the page."}
          </span>
        </Card>
        {file.error ? <Card className="p-4 text-sm">{errorMessage(file.error)}</Card> : !file.data ? <Card className="aspect-[1/1.414]" /> : (
          <PdfPages data={file.data} label={doc.title} onPageClick={place}
            overlay={(page) => list.filter((f) => f.page === page).map((f) => (
              <Box key={f.key} f={f} color={color(f.signer)} who={name(f.signer)} selected={selected === f.key}
                onSelect={() => setSelected(f.key)} onMove={(p) => update(f.key, p)} onRemove={() => remove(f.key)} />
            ))} />
        )}
      </div>

      <div className="grid content-start gap-4">
        <Card className="grid gap-3 p-4">
          <h2 className="font-semibold">Signers</h2>
          <SignerList value={signers} onChange={changeSigners} ordered={opts.ordered} />
          {signers.length > 1 && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={opts.ordered} onChange={(e) => { setOpts({ ...opts, ordered: e.target.checked }); touch(); }} /> Sign in this order (one after another)
            </label>
          )}
          {signers.length > 0 && (
            <ul className="grid gap-1 text-xs text-muted-foreground" aria-label="Boxes per signer">
              {signers.map((_, i) => (
                <li key={i} className="flex items-center gap-2">
                  <span className="size-2.5 rounded-full" style={{ background: color(i) }} />{name(i)}: {counts[i]} box{counts[i] === 1 ? "" : "es"}
                  {!list.some((f) => f.signer === i && (f.kind === "signature" || f.kind === "initials")) && <span className="text-warning">· needs a signature box</span>}
                </li>
              ))}
            </ul>
          )}
        </Card>

        {sel && (
          <Card className="grid gap-3 p-4" role="group" aria-label="Selected box">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">{FIELD_LABEL[sel.kind]} box</h2>
              <Button size="sm" variant="ghost" onClick={() => remove(sel.key)}><Trash2 /> Remove</Button>
            </div>
            <Field label="For">{(a) => (
              <Select {...a} value={String(sel.signer)} onChange={(e) => update(sel.key, { signer: Number(e.target.value) })}>
                {signers.map((_, i) => <option key={i} value={i}>{name(i)}</option>)}
              </Select>
            )}</Field>
            {sel.kind === "text" && (
              <>
                <Field label="What to fill in" hint="Shown to the signer, e.g. “IBAN” or “Address”.">{(a) => <Input {...a} value={sel.label ?? ""} onChange={(e) => update(sel.key, { label: e.target.value })} maxLength={80} />}</Field>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={sel.required} onChange={(e) => update(sel.key, { required: e.target.checked })} /> Required</label>
              </>
            )}
          </Card>
        )}

        <Card className="grid gap-3 p-4">
          <h2 className="font-semibold">Options</h2>
          <Field label="Message to signers" hint="Included in the email.">{(a) => (
            <Textarea {...a} rows={3} maxLength={2000} value={opts.message} onChange={(e) => { setOpts({ ...opts, message: e.target.value }); touch(); }} />
          )}</Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Expires on">{(a) => <Input {...a} type="date" min={today()} value={opts.expiresOn} onChange={(e) => { setOpts({ ...opts, expiresOn: e.target.value }); touch(); }} />}</Field>
            <Field label="Remind every (days)" hint="0 = no reminders">{(a) => (
              <Input {...a} type="number" min={0} max={30} value={opts.remindEveryDays} onChange={(e) => { setOpts({ ...opts, remindEveryDays: Number(e.target.value) }); touch(); }} />
            )}</Field>
          </div>
          <Field label="File with a team member" hint="When everyone has signed, it's listed in their HR documents.">{(a) => (
            <Select {...a} value={opts.employeeId} onChange={(e) => { setOpts({ ...opts, employeeId: e.target.value }); touch(); }}>
              <option value="">Nobody</option>
              {team.data?.map((p) => <option key={p.userId} value={p.userId}>{p.name}</option>)}
            </Select>
          )}</Field>
          {!cfg.emailReady && (
            <p className="rounded-md bg-warning-soft p-2 text-xs text-warning">
              Email isn't set up, so nobody gets an email. After sending you get a signing link for each signer to send yourself.
              {cfg.canManage && " Fill in the email settings under Add features → Docs & e-sign → Settings."}
            </p>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" loading={busy === "save"} disabled={!!busy} onClick={() => void onSave()}>Save draft</Button>
            <Button loading={busy === "send"} disabled={!!busy} onClick={() => void onSend()}><Send /> Send for signature</Button>
          </div>
        </Card>
      </div>
    </div>
  );
}

/** A placed box: drag to move, drag the corner to resize, Delete to remove. */
function Box({ f, color, who, selected, onSelect, onMove, onRemove }: {
  f: FieldDraft; color: string; who: string; selected: boolean; onSelect: () => void; onMove: (p: Partial<FieldDraft>) => void; onRemove: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = (mode: "move" | "resize") => (e: React.PointerEvent) => {
    e.stopPropagation(); e.preventDefault();
    onSelect();
    const page = ref.current?.parentElement?.getBoundingClientRect();
    if (!page) return;
    const start = { x: e.clientX, y: e.clientY, f: { ...f } };
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - start.x) / page.width, dy = (ev.clientY - start.y) / page.height;
      if (mode === "move") onMove({ x: clamp(start.f.x + dx, 0, 1 - f.w), y: clamp(start.f.y + dy, 0, 1 - f.h) });
      else onMove({ w: clamp(start.f.w + dx, 0.03, 1 - f.x), h: clamp(start.f.h + dy, 0.015, 1 - f.y) });
    };
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const label = f.kind === "text" && f.label ? f.label : FIELD_LABEL[f.kind];
  return (
    <div ref={ref} role="button" tabIndex={0} aria-label={`${FIELD_LABEL[f.kind]} for ${who}`} aria-pressed={selected}
      className="absolute flex cursor-move select-none items-center overflow-hidden rounded-sm px-1 text-[11px] font-medium leading-none"
      style={{ left: `${f.x * 100}%`, top: `${f.y * 100}%`, width: `${f.w * 100}%`, height: `${f.h * 100}%`, background: `${color}22`, border: `${selected ? 2 : 1}px solid ${color}`, color }}
      onPointerDown={drag("move")} onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 0.02 : 0.005;
        if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); onRemove(); }
        else if (e.key === "ArrowLeft") onMove({ x: clamp(f.x - step, 0, 1 - f.w) });
        else if (e.key === "ArrowRight") onMove({ x: clamp(f.x + step, 0, 1 - f.w) });
        else if (e.key === "ArrowUp") onMove({ y: clamp(f.y - step, 0, 1 - f.h) });
        else if (e.key === "ArrowDown") onMove({ y: clamp(f.y + step, 0, 1 - f.h) });
        else return;
        e.preventDefault();
      }}>
      <span className="truncate">{label} · {who}</span>
      {selected && (
        <>
          <button type="button" aria-label="Remove box" className="absolute right-0 top-0 grid size-4 place-items-center rounded-bl bg-white/80" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); onRemove(); }}><X className="size-3" /></button>
          <span aria-hidden className="absolute bottom-0 right-0 size-2.5 cursor-nwse-resize" style={{ background: color }} onPointerDown={drag("resize")} />
        </>
      )}
    </div>
  );
}

