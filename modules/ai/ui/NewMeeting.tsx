import { useRef, useState } from "react";
import { ArrowLeft, FileUp, Handshake, Sparkles, User, X } from "lucide-react";
import { Button, Card, Field, Input, PageHeader, Select, Skeleton, Textarea, toast } from "@office/ui";
import { useModuleHost, type PageProps } from "@office/ui/module-ui";
import { ACCEPT, fileToText, TranscriptError } from "./transcript.ts";
import { errorMessage, fmtNum, SetupNotice, today, useCrmOn, useDebounced, useLoad, type Config, type Detail } from "./shared.tsx";

interface ContactRow { id: string; firstName: string | null; lastName: string | null; email: string | null }
interface DealRow { id: string; title: string; contactName: string | null; companyName: string | null }
const contactName = (c: ContactRow) => [c.firstName, c.lastName].filter(Boolean).join(" ") || c.email || "Contact";
const query = () => new URLSearchParams(window.location.search);
const MAX = 300_000;

/** Search-and-pick for a contact or a deal. */
function Picker<T extends { id: string }>({ label, icon, value, onChange, search, show }: {
  label: string; icon: React.ReactNode; value: { id: string; name: string } | null; onChange: (v: { id: string; name: string } | null) => void;
  search: (q: string) => Promise<T[]>; show: (t: T) => string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const dq = useDebounced(q);
  const found = useLoad(() => (open ? search(dq.trim()) : Promise.resolve([] as T[])), [open, dq]);
  if (value) {
    return (
      <div className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
        {icon}<span className="min-w-0 flex-1 truncate">{value.name}</span>
        <Button size="icon" variant="ghost" aria-label={`Remove ${label.toLowerCase()}`} onClick={() => onChange(null)}><X /></Button>
      </div>
    );
  }
  if (!open) return <Button variant="outline" className="justify-start" onClick={() => setOpen(true)}>{icon} Link a {label.toLowerCase()}</Button>;
  return (
    <div className="grid gap-1 rounded-md border p-2">
      <div className="flex gap-2">
        <Input aria-label={`Search ${label.toLowerCase()}s`} autoFocus placeholder={`Search ${label.toLowerCase()}s…`} value={q} onChange={(e) => setQ(e.target.value)} />
        <Button variant="ghost" onClick={() => { setOpen(false); setQ(""); }}>Cancel</Button>
      </div>
      <ul aria-label={`${label}s found`} className="grid">
        {found.data?.map((t) => (
          <li key={t.id}>
            <button type="button" className="w-full rounded px-2 py-1.5 text-left text-sm hover:bg-accent" onClick={() => { onChange({ id: t.id, name: show(t) }); setOpen(false); setQ(""); }}>
              {show(t)}
            </button>
          </li>
        ))}
        {found.data && !found.data.length && <li className="px-2 py-1.5 text-sm text-muted-foreground">Nothing found</li>}
      </ul>
    </div>
  );
}

export function NewMeeting(_: PageProps) {
  const host = useModuleHost();
  const cfg = useLoad(() => host.api.get<Config>("/config"), [host]);
  const crmOn = useCrmOn();
  const qs = query();
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(today());
  const [text, setText] = useState("");
  const [sourceName, setSourceName] = useState<string | null>(null);
  const [attendees, setAttendees] = useState<{ name: string; email?: string }[]>([]);
  const [typed, setTyped] = useState("");
  const [visibility, setVisibility] = useState<"team" | "private">("team");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Opened from a contact or a deal: start linked to it.
  const initial = useLoad(async () => {
    const c = qs.get("contact"), d = qs.get("deal");
    const contact = c ? await host.core.get<ContactRow>(`/contacts/${c}`).then((r) => ({ id: r.id, name: contactName(r) })).catch(() => null) : null;
    const deal = d ? await host.core.get<DealRow>(`/m/crm/deals/${d}`).then((r) => ({ id: r.id, name: r.title })).catch(() => null) : null;
    return { contact, deal };
  }, [host]);
  const [contact, setContact] = useState<{ id: string; name: string } | null | undefined>(undefined);
  const [deal, setDeal] = useState<{ id: string; name: string } | null | undefined>(undefined);
  const linkedContact = contact === undefined ? initial.data?.contact ?? null : contact;
  const linkedDeal = deal === undefined ? initial.data?.deal ?? null : deal;

  async function pick(file: File | undefined) {
    if (!file) return;
    try {
      const t = fileToText(file.name, new Uint8Array(await file.arrayBuffer()));
      if (!t.trim()) { toast.error("That file has no text in it"); return; }
      setText(t.slice(0, MAX)); setSourceName(file.name);
      if (!title) setTitle(file.name.replace(/\.[a-z0-9]{1,5}$/i, "").replace(/[_]+/g, " ").slice(0, 200));
      if (t.length > MAX) toast.error("The file is longer than 300,000 characters; only the start was kept");
    } catch (e) { toast.error(e instanceof TranscriptError ? e.message : "This file couldn't be read"); }
    finally { if (fileRef.current) fileRef.current.value = ""; }
  }

  const addAttendee = (a: { name: string; email?: string }) => {
    if (!a.name.trim() || attendees.some((x) => x.name.toLowerCase() === a.name.trim().toLowerCase())) return;
    setAttendees([...attendees, { ...a, name: a.name.trim() }]);
  };

  async function submit() {
    setError(null);
    if (text.trim().length < 20) { setError("Paste the meeting notes or transcript (at least a few sentences)"); return; }
    setBusy(true);
    try {
      const r = await host.api.post<Detail>("/summaries", {
        title: title.trim() || undefined, text, sourceName: sourceName ?? undefined, meetingDate: date || null, attendees,
        contactId: linkedContact?.id ?? null, dealId: linkedDeal?.id ?? null, visibility, companyName: host.tenant.name,
      });
      toast.success("Summary ready");
      host.navigate(`/ai/${r.id}`);
    } catch (e) { setError(errorMessage(e)); setBusy(false); }
  }

  if (!cfg.data) return <Skeleton className="h-96" />;
  const c = cfg.data;
  const team = c.people.filter((p) => !attendees.some((a) => a.name === p.name));
  return (
    <>
      <Button variant="ghost" size="sm" className="mb-2 -ml-2" onClick={() => host.navigate("/ai")}><ArrowLeft /> Summaries</Button>
      <PageHeader title="New meeting summary" description="Paste notes or a transcript. Claude writes the summary, decisions, action items and a follow-up email." />
      {!c.ready && <SetupNotice />}
      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <Card className="grid content-start gap-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-medium">Notes or transcript</p>
            <input ref={fileRef} type="file" accept={ACCEPT} className="hidden" aria-label="Transcript file" onChange={(e) => void pick(e.target.files?.[0])} />
            <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}><FileUp /> Upload file</Button>
          </div>
          <Textarea aria-label="Notes or transcript" rows={18} value={text} maxLength={MAX} disabled={busy}
            onChange={(e) => { setText(e.target.value); if (sourceName && !e.target.value) setSourceName(null); }}
            placeholder={"Paste your meeting notes, or a transcript from Zoom, Teams or Google Meet.\n\nFiles: .txt, .vtt, .srt (subtitles) or .docx (Word)."} />
          <p className="text-xs text-muted-foreground">
            {sourceName ? `From ${sourceName} · ` : ""}{fmtNum(text.length)} characters{text.length > 0 ? ` · about ${fmtNum(Math.ceil(text.length / 3.5))} tokens` : ""}.
            {" "}The text is sent to Anthropic (Claude) to be summarised.
          </p>
        </Card>

        <div className="grid content-start gap-4">
          <Card className="grid gap-3 p-4">
            <Field label="Meeting name" hint="Leave empty and Claude picks one">{(a) => <Input {...a} value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />}</Field>
            <Field label="Date">{(a) => <Input {...a} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
            <div className="grid gap-1.5">
              <p className="text-sm font-medium">Who was there</p>
              {attendees.length > 0 && (
                <ul aria-label="Attendees" className="flex flex-wrap gap-1.5">
                  {attendees.map((a) => (
                    <li key={a.name} className="inline-flex items-center gap-1 rounded-full bg-muted py-0.5 pl-2.5 pr-1 text-sm">
                      {a.name}
                      <button type="button" aria-label={`Remove ${a.name}`} className="rounded-full p-0.5 hover:bg-accent" onClick={() => setAttendees(attendees.filter((x) => x !== a))}><X className="size-3" /></button>
                    </li>
                  ))}
                </ul>
              )}
              {team.length > 0 && (
                <Select aria-label="Add a team member" value="" onChange={(e) => { const p = c.people.find((x) => x.userId === e.target.value); if (p) addAttendee({ name: p.name, email: p.email }); }}>
                  <option value="">Add a team member…</option>
                  {team.map((p) => <option key={p.userId} value={p.userId}>{p.name}</option>)}
                </Select>
              )}
              <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); addAttendee({ name: typed }); setTyped(""); }}>
                <Input aria-label="Add someone else" placeholder="Someone else (name)" value={typed} maxLength={200} onChange={(e) => setTyped(e.target.value)} />
                <Button type="submit" variant="outline" disabled={!typed.trim()}>Add</Button>
              </form>
            </div>
          </Card>

          <Card className="grid gap-3 p-4">
            <p className="text-sm font-medium">Link to</p>
            {host.can("core:contacts.read") && (
              <Picker<ContactRow> label="Contact" icon={<User className="size-4" />} value={linkedContact} onChange={setContact} show={contactName}
                search={(q) => host.core.get<{ data: ContactRow[] }>("/contacts", { q: q || undefined, limit: 8 }).then((r) => r.data)} />
            )}
            {crmOn.data && (
              <Picker<DealRow> label="Deal" icon={<Handshake className="size-4" />} value={linkedDeal} onChange={setDeal} show={(d) => d.title}
                search={(q) => host.core.get<{ data: DealRow[] }>("/m/crm/deals", { q: q || undefined, limit: 8 }).then((r) => r.data)} />
            )}
            <Field label="Who can see it">{(a) => (
              <Select {...a} value={visibility} onChange={(e) => setVisibility(e.target.value as "team" | "private")}>
                <option value="team">Everyone in the team</option>
                <option value="private">Only me (and managers)</option>
              </Select>
            )}</Field>
          </Card>

          {error && <p role="alert" className="rounded-md bg-danger-soft p-3 text-sm text-destructive">{error}</p>}
          <Button size="lg" loading={busy} disabled={!c.ready || !c.canWrite} onClick={() => void submit()}><Sparkles /> Summarise</Button>
          {busy && <p className="text-center text-sm text-muted-foreground" role="status">Claude is reading the notes. This usually takes 10 to 40 seconds.</p>}
        </div>
      </div>
    </>
  );
}
