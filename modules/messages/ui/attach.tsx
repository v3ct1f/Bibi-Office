import { useEffect, useRef, useState } from "react";
import { BarChart3, Camera, CalendarDays, FileText, Headphones, Image, Plus, RefreshCw, Search, Sticker, Trash2, UserRound } from "lucide-react";
import {
  Button, DateTimePicker, Dialog, DialogContent, DialogFooter, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, Field, Input, Switch,
  Tabs, TabsList, TabsTrigger, Textarea, toast,
} from "@office/ui";
import { useModuleHost } from "@office/ui/module-ui";
import { Avatar, errorMessage, type Person } from "./shared.tsx";

export type AttachKind = "document" | "media" | "camera" | "audio" | "contact" | "poll" | "event" | "sticker";
const ITEMS: { kind: AttachKind; label: string; icon: typeof FileText; color: string }[] = [
  { kind: "document", label: "Document", icon: FileText, color: "text-violet-500" },
  { kind: "media", label: "Photos & videos", icon: Image, color: "text-sky-500" },
  { kind: "camera", label: "Camera", icon: Camera, color: "text-pink-500" },
  { kind: "audio", label: "Audio", icon: Headphones, color: "text-orange-500" },
  { kind: "contact", label: "Contact", icon: UserRound, color: "text-blue-500" },
  { kind: "poll", label: "Poll", icon: BarChart3, color: "text-amber-500" },
  { kind: "event", label: "Event", icon: CalendarDays, color: "text-rose-500" },
  { kind: "sticker", label: "New sticker", icon: Sticker, color: "text-emerald-500" },
];

export function AttachMenu({ onPick }: { onPick: (k: AttachKind) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="size-8 shrink-0 rounded-full" aria-label="Attach"><Plus /></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="min-w-52">
        {ITEMS.map((i) => (
          <DropdownMenuItem key={i.kind} onSelect={() => onPick(i.kind)}>
            <i.icon className={`size-4 ${i.color}`} /> {i.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ── Camera: take a photo with the webcam / phone camera ─────────────────────
export function CameraDialog({ open, onOpenChange, onPhoto }: { open: boolean; onOpenChange: (o: boolean) => void; onPhoto: (f: File) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [facing, setFacing] = useState<"user" | "environment">("user");
  useEffect(() => {
    if (!open) return;
    let alive = true, s: MediaStream | null = null;
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia) { setError("This browser can't use the camera here. Use Photos & videos instead."); return; }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: facing }, audio: false })
      .then((m) => { if (!alive) { m.getTracks().forEach((t) => t.stop()); return; } s = m; setStream(m); if (video.current) video.current.srcObject = m; })
      .catch(() => { if (alive) setError("No camera, or access was blocked. Allow the camera for this site in your browser, then try again."); });
    return () => { alive = false; s?.getTracks().forEach((t) => t.stop()); setStream(null); };
  }, [open, facing]);

  const snap = () => {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const c = document.createElement("canvas");
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext("2d")!.drawImage(v, 0, 0);
    c.toBlob((b) => {
      if (!b) return toast.error("Could not take the photo");
      onPhoto(new File([b], `photo-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.jpg`, { type: "image/jpeg" }));
      onOpenChange(false);
    }, "image/jpeg", 0.9);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Take a photo" wide>
        {error ? <p className="rounded-md bg-muted p-4 text-sm text-muted-foreground">{error}</p> : (
          <video ref={video} autoPlay playsInline muted aria-label="Camera preview" className="max-h-[60vh] w-full rounded-md bg-black object-contain" />
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          {!error && <Button variant="outline" onClick={() => setFacing((f) => (f === "user" ? "environment" : "user"))}><RefreshCw /> Switch camera</Button>}
          <Button disabled={!stream || !!error} onClick={snap}><Camera /> Take photo</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Contact card ────────────────────────────────────────────────────────────
export interface ContactInput { name: string; phone?: string; email?: string; company?: string; jobTitle?: string }
interface CoreContact { id: string; firstName: string | null; lastName: string | null; email: string | null; phone: string | null }

export function ContactDialog({ open, onOpenChange, onSend }: { open: boolean; onOpenChange: (o: boolean) => void; onSend: (c: ContactInput) => Promise<void> }) {
  const host = useModuleHost();
  const canContacts = host.can("core:contacts.read");
  const [tab, setTab] = useState<"contacts" | "colleagues" | "type">(canContacts ? "contacts" : "colleagues");
  const [q, setQ] = useState("");
  const [contacts, setContacts] = useState<CoreContact[] | null>(null);
  const [people, setPeople] = useState<Person[] | null>(null);
  const [f, setF] = useState({ name: "", phone: "", email: "", company: "", jobTitle: "" });
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setQ(""); setF({ name: "", phone: "", email: "", company: "", jobTitle: "" }); } }, [open]);
  useEffect(() => {
    if (!open || tab !== "contacts" || !canContacts) return;
    const t = setTimeout(() => {
      host.core.get<{ data: CoreContact[] }>("/contacts", { limit: 30, ...(q.trim() ? { q: q.trim() } : {}) }).then((r) => setContacts(r.data)).catch(() => setContacts([]));
    }, 250);
    return () => clearTimeout(t);
  }, [open, tab, q, host, canContacts]);
  useEffect(() => { if (open && tab === "colleagues" && !people) host.api.get<Person[]>("/people").then(setPeople).catch(() => setPeople([])); }, [open, tab, people, host]);

  const send = async (c: ContactInput) => {
    if (!c.phone && !c.email) return toast.error("This contact has no phone number or email to share");
    setBusy(true);
    try { await onSend(c); onOpenChange(false); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };
  const n = q.trim().toLowerCase();
  const row = (key: string, name: string, sub: string, pick: () => void) => (
    <li key={key}>
      <button type="button" disabled={busy} onClick={pick} className="flex w-full cursor-pointer items-center gap-3 px-3 py-2 text-left hover:bg-accent">
        <Avatar name={name} id={key} size="sm" />
        <span className="min-w-0"><span className="block truncate text-sm font-medium">{name}</span><span className="block truncate text-xs text-muted-foreground">{sub || "No phone or email"}</span></span>
      </button>
    </li>
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Share a contact">
        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
          <TabsList>
            {canContacts && <TabsTrigger value="contacts">Contacts</TabsTrigger>}
            <TabsTrigger value="colleagues">Colleagues</TabsTrigger>
            <TabsTrigger value="type">Type it in</TabsTrigger>
          </TabsList>
        </Tabs>
        {tab === "type" ? (
          <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); void send({ name: f.name.trim(), phone: f.phone.trim(), email: f.email.trim(), company: f.company.trim(), jobTitle: f.jobTitle.trim() }); }}>
            <Field label="Name" required>{(a) => <Input {...a} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={200} autoFocus />}</Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Phone">{(a) => <Input {...a} type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} maxLength={50} />}</Field>
              <Field label="Email">{(a) => <Input {...a} type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} maxLength={320} />}</Field>
              <Field label="Company">{(a) => <Input {...a} value={f.company} onChange={(e) => setF({ ...f, company: e.target.value })} maxLength={200} />}</Field>
              <Field label="Job title">{(a) => <Input {...a} value={f.jobTitle} onChange={(e) => setF({ ...f, jobTitle: e.target.value })} maxLength={200} />}</Field>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit" loading={busy} disabled={!f.name.trim() || (!f.phone.trim() && !f.email.trim())}>Send contact</Button>
            </DialogFooter>
          </form>
        ) : (
          <div className="grid gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
              <Input aria-label="Search contacts" className="pl-8" placeholder="Search by name or email" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
            </div>
            <ul className="max-h-72 overflow-y-auto rounded-md border" aria-label="Pick a contact">
              {tab === "contacts"
                ? !contacts ? <li className="p-3 text-sm text-muted-foreground">Loading…</li>
                  : !contacts.length ? <li className="p-3 text-sm text-muted-foreground">No contacts found.</li>
                  : contacts.map((c) => {
                    const name = [c.firstName, c.lastName].filter(Boolean).join(" ") || c.email || c.phone || "Contact";
                    return row(c.id, name, [c.phone, c.email].filter(Boolean).join(" · "), () => void send({ name, ...(c.phone ? { phone: c.phone } : {}), ...(c.email ? { email: c.email } : {}) }));
                  })
                : !people ? <li className="p-3 text-sm text-muted-foreground">Loading…</li>
                  : people.filter((p) => !n || p.name.toLowerCase().includes(n) || p.email.toLowerCase().includes(n))
                    .map((p) => row(p.userId, p.name, p.email, () => void send({ name: p.name, email: p.email })))}
            </ul>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Poll ────────────────────────────────────────────────────────────────────
export interface PollInput { question: string; options: string[]; multiple: boolean }
export function PollDialog({ open, onOpenChange, onSend }: { open: boolean; onOpenChange: (o: boolean) => void; onSend: (p: PollInput) => Promise<void> }) {
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState(["", ""]);
  const [multiple, setMultiple] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setQuestion(""); setOptions(["", ""]); setMultiple(false); } }, [open]);
  const filled = options.map((o) => o.trim()).filter(Boolean);
  const setAt = (i: number, v: string) => setOptions((os) => {
    const n = os.map((o, j) => (j === i ? v : o));
    // Always keep one empty box at the end to type the next option (up to 12).
    if (n.length < 12 && n.at(-1)!.trim()) n.push("");
    return n;
  });
  const send = async () => {
    if (!question.trim()) return toast.error("Ask a question");
    if (filled.length < 2) return toast.error("Add at least two options");
    setBusy(true);
    try { await onSend({ question: question.trim(), options: filled, multiple }); onOpenChange(false); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Create poll">
        <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); void send(); }}>
          <Field label="Question" required>{(a) => <Input {...a} value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={300} placeholder="Ask something" autoFocus />}</Field>
          <fieldset className="grid gap-2">
            <legend className="mb-1.5 text-sm font-medium">Options</legend>
            {options.map((o, i) => (
              <div key={i} className="flex gap-2">
                <Input aria-label={`Option ${i + 1}`} value={o} onChange={(e) => setAt(i, e.target.value)} maxLength={100} placeholder={`Option ${i + 1}`} />
                {options.length > 2 && o && (
                  <Button type="button" variant="ghost" size="icon" aria-label={`Remove option ${i + 1}`} onClick={() => setOptions((os) => os.filter((_, j) => j !== i))}><Trash2 /></Button>
                )}
              </div>
            ))}
          </fieldset>
          <label className="flex items-center justify-between gap-3 text-sm">
            Allow more than one answer
            <Switch checked={multiple} onCheckedChange={setMultiple} aria-label="Allow more than one answer" />
          </label>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" loading={busy}>Send poll</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Event ───────────────────────────────────────────────────────────────────
export interface EventInput { title: string; startsAt: string; endsAt?: string; location?: string; description?: string }
const localNow = () => { const d = new Date(Date.now() + 3600_000); d.setMinutes(0, 0, 0); return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16); };
const toIso = (local: string) => new Date(local).toISOString();

export function EventDialog({ open, onOpenChange, onSend }: { open: boolean; onOpenChange: (o: boolean) => void; onSend: (e: EventInput) => Promise<void> }) {
  const [f, setF] = useState({ title: "", start: "", end: "", location: "", description: "" });
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setF({ title: "", start: localNow(), end: "", location: "", description: "" }); }, [open]);
  const endBad = !!f.end && !!f.start && f.end < f.start;
  const send = async () => {
    if (!f.title.trim()) return toast.error("Give the event a name");
    if (!f.start) return toast.error("Pick when it starts");
    if (endBad) return toast.error("The end must be after the start");
    setBusy(true);
    try {
      await onSend({
        title: f.title.trim(), startsAt: toIso(f.start), ...(f.end ? { endsAt: toIso(f.end) } : {}),
        ...(f.location.trim() ? { location: f.location.trim() } : {}), ...(f.description.trim() ? { description: f.description.trim() } : {}),
      });
      onOpenChange(false);
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Create event">
        <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); void send(); }}>
          <Field label="Event name" required>{(a) => <Input {...a} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} maxLength={200} autoFocus />}</Field>
          <Field label="Starts" required>{(a) => <DateTimePicker {...a} value={f.start} onChange={(v) => setF({ ...f, start: v })} />}</Field>
          <Field label="Ends (optional)" error={endBad ? "The end must be after the start" : undefined}>
            {(a) => <DateTimePicker {...a} value={f.end} min={f.start} defaultTime={f.start.slice(11, 16) || "10:00"} onChange={(v) => setF({ ...f, end: v })} />}
          </Field>
          <Field label="Location (optional)">{(a) => <Input {...a} value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} maxLength={300} placeholder="Address, room or video link" />}</Field>
          <Field label="Description (optional)">{(a) => <Textarea {...a} rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} maxLength={2000} />}</Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" loading={busy}>Send event</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── New sticker: any picture, cut to a square ───────────────────────────────
export async function makeSticker(file: File): Promise<File> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new window.Image(); i.onload = () => resolve(i); i.onerror = () => reject(new Error("That picture can't be opened")); i.src = url;
    });
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const size = Math.min(512, side);
    const c = document.createElement("canvas");
    c.width = size; c.height = size;
    c.getContext("2d")!.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, size, size);
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/png"));
    if (!blob) throw new Error("Could not make the sticker");
    return new File([blob], "sticker.png", { type: "image/png" });
  } finally { URL.revokeObjectURL(url); }
}
