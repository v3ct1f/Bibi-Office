import { useState } from "react";
import { CalendarDays, CalendarPlus, Check, Download, FileText, Mail, MapPin, Mic, Pause, Phone, Play, UserPlus } from "lucide-react";
import { Button, Spinner, cn, toast } from "@office/ui";
import { useModuleHost } from "@office/ui/module-ui";
import {
  Avatar, errorMessage, fetchFile, fmtDuration, fmtSize, saveBlob, useFileUrl,
  type ContactData, type EventData, type FileRef, type Message, type PollData,
} from "./shared.tsx";

// ── Files: photo, video, audio, voice, document ─────────────────────────────
export function FileView({ m }: { m: Message }) {
  const host = useModuleHost();
  const f = m.file!;
  const voice = !!(m.data as { voice?: boolean } | null)?.voice;
  const t = f.contentType;
  if (voice || t.startsWith("audio/")) return <AudioView f={f} voice={voice} durationMs={(m.data as { durationMs?: number } | null)?.durationMs ?? null} mine={m.mine} />;
  if (t.startsWith("image/")) return <ImageView f={f} />;
  if (t.startsWith("video/")) return <VideoView f={f} />;
  const download = () => fetchFile(host.api, f).then((b) => saveBlob(b, f.name)).catch((e) => toast.error(errorMessage(e)));
  return (
    <button type="button" onClick={() => void download()} className="flex max-w-xs cursor-pointer items-center gap-2 rounded-md border bg-surface px-3 py-2 text-left text-foreground hover:bg-accent">
      <FileText className="size-5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{f.name}</span><span className="block text-xs text-muted-foreground">{fmtSize(f.sizeBytes)}</span></span>
      <Download className="size-4 shrink-0 text-muted-foreground" />
    </button>
  );
}

function ImageView({ f, sticker }: { f: FileRef; sticker?: boolean }) {
  const host = useModuleHost();
  const { url } = useFileUrl(host.api, f, true);
  if (sticker) return url ? <img src={url} alt="Sticker" className="size-40 object-contain" /> : <div className="grid size-40 place-items-center"><Spinner /></div>;
  return (
    <button type="button" onClick={() => url && void fetch(url).then((r) => r.blob()).then((b) => saveBlob(b, f.name))}
      className="block cursor-pointer overflow-hidden rounded-md border bg-muted" aria-label={`Download ${f.name}`}>
      {url ? <img src={url} alt={f.name} className="max-h-72 max-w-full object-contain" /> : <div className="grid h-40 w-56 place-items-center"><Spinner /></div>}
    </button>
  );
}

function VideoView({ f }: { f: FileRef }) {
  const host = useModuleHost();
  const [load, setLoad] = useState(f.sizeBytes < 3 * 1024 * 1024);
  const { url, error } = useFileUrl(host.api, f, load);
  if (url) return <video src={url} controls playsInline aria-label={f.name} className="max-h-80 max-w-full rounded-md bg-black" />;
  return (
    <button type="button" onClick={() => setLoad(true)} aria-label={`Play video ${f.name}`}
      className="grid h-44 w-64 max-w-full cursor-pointer place-items-center rounded-md bg-black/80 text-white">
      {load && !error ? <Spinner /> : (
        <span className="grid justify-items-center gap-1 text-xs">
          <span className="grid size-12 place-items-center rounded-full bg-white/20"><Play className="size-6" /></span>
          {error ? "Couldn't load, tap to retry" : `${f.name} · ${fmtSize(f.sizeBytes)}`}
        </span>
      )}
    </button>
  );
}

function AudioView({ f, voice, durationMs, mine }: { f: FileRef; voice: boolean; durationMs: number | null; mine: boolean }) {
  const host = useModuleHost();
  const [load, setLoad] = useState(false);
  const [audio, setAudio] = useState<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);
  const { url } = useFileUrl(host.api, f, load);
  const toggle = () => {
    if (!load) { setLoad(true); return; }
    if (!audio) return;
    if (playing) audio.pause(); else void audio.play();
  };
  const total = durationMs ?? (audio && Number.isFinite(audio.duration) ? audio.duration * 1000 : 0);
  return (
    <div className={cn("flex w-64 max-w-full items-center gap-3 rounded-2xl px-3 py-2", mine ? "bg-primary text-primary-foreground" : "bg-muted")}>
      <Button size="icon" variant="ghost" className={cn("size-9 shrink-0 rounded-full", mine ? "hover:bg-white/15" : "")} aria-label={playing ? "Pause" : voice ? "Play voice message" : `Play ${f.name}`} onClick={toggle}>
        {load && !url ? <Spinner /> : playing ? <Pause /> : <Play />}
      </Button>
      <div className="min-w-0 flex-1">
        <div className={cn("h-1 overflow-hidden rounded-full", mine ? "bg-white/30" : "bg-foreground/15")}>
          <div className={cn("h-full", mine ? "bg-white" : "bg-primary")} style={{ width: total ? `${Math.min(100, (pos / total) * 100)}%` : "0%" }} />
        </div>
        <p className={cn("mt-1 flex items-center gap-1 truncate text-[11px]", mine ? "text-primary-foreground/80" : "text-muted-foreground")}>
          {voice ? <Mic className="size-3" /> : null}{voice ? fmtDuration(playing || pos ? pos : total) : f.name}
        </p>
      </div>
      {url && (
        <audio ref={setAudio} src={url} autoPlay preload="auto" className="hidden"
          onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => { setPlaying(false); setPos(0); }}
          onTimeUpdate={(e) => setPos(e.currentTarget.currentTime * 1000)} />
      )}
    </div>
  );
}

export function StickerView({ m }: { m: Message }) {
  const d = m.data as { emoji?: string } | null;
  if (d?.emoji) return <span className="select-none text-7xl leading-none drop-shadow-sm" role="img" aria-label={`Sticker ${d.emoji}`}>{d.emoji}</span>;
  return m.file ? <ImageView f={m.file} sticker /> : null;
}

export function GifView({ m }: { m: Message }) {
  const d = m.data as { url: string; width: number; height: number; title: string };
  const w = Math.min(260, d.width), h = Math.round((w / d.width) * d.height);
  return (
    <span className="relative block overflow-hidden rounded-md bg-muted" style={{ width: w, height: h }}>
      <img src={d.url} alt={d.title || "GIF"} width={w} height={h} loading="lazy" referrerPolicy="no-referrer" className="size-full object-cover" />
      <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1 text-[10px] font-bold text-white">GIF</span>
    </span>
  );
}

// ── Poll ────────────────────────────────────────────────────────────────────
export function PollCard({ m, onChange }: { m: Message; onChange: (m: Message) => void }) {
  const host = useModuleHost();
  const d = m.data as unknown as PollData;
  const [busy, setBusy] = useState(false);
  const [showVotes, setShowVotes] = useState(false);
  const mine = d.options.filter((o) => o.mine).map((o) => o.id);
  const max = Math.max(1, ...d.options.map((o) => o.votes));
  const pick = async (id: string) => {
    const next = d.multiple ? (mine.includes(id) ? mine.filter((x) => x !== id) : [...mine, id]) : mine.includes(id) ? [] : [id];
    setBusy(true);
    try { onChange(await host.api.post<Message>(`/messages/${m.id}/vote`, { optionIds: next })); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <div className="w-72 max-w-full rounded-2xl border bg-surface p-3 text-foreground" role="group" aria-label={`Poll: ${d.question}`}>
      <p className="font-semibold">{d.question}</p>
      <p className="mb-2 text-xs text-muted-foreground">{d.multiple ? "Select one or more" : "Select one"}</p>
      <ul className="grid gap-2">
        {d.options.map((o) => (
          <li key={o.id}>
            <button type="button" disabled={busy} onClick={() => void pick(o.id)} aria-pressed={o.mine} title={o.voters.join(", ")}
              className="grid w-full cursor-pointer gap-1 text-left disabled:cursor-wait">
              <span className="flex items-center gap-2 text-sm">
                <span className={cn("grid size-4 shrink-0 place-items-center border", d.multiple ? "rounded" : "rounded-full", o.mine ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/50")}>
                  {o.mine && <Check className="size-3" />}
                </span>
                <span className="min-w-0 flex-1 break-words">{o.text}</span>
                <span className="text-xs tabular-nums text-muted-foreground">{o.votes}</span>
              </span>
              <span className="ml-6 h-1.5 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full bg-primary transition-all" style={{ width: `${(o.votes / max) * 100}%` }} /></span>
            </button>
          </li>
        ))}
      </ul>
      <button type="button" className="mt-3 w-full cursor-pointer border-t pt-2 text-center text-xs font-medium text-primary" onClick={() => setShowVotes((v) => !v)}>
        {showVotes ? "Hide votes" : `View votes (${d.voters} ${d.voters === 1 ? "person" : "people"})`}
      </button>
      {showVotes && (
        <dl className="mt-2 grid gap-1 text-xs">
          {d.options.map((o) => <div key={o.id}><dt className="font-medium">{o.text}</dt><dd className="text-muted-foreground">{o.voters.join(", ") || "No votes"}</dd></div>)}
        </dl>
      )}
    </div>
  );
}

// ── Event ───────────────────────────────────────────────────────────────────
const fmtEventTime = (start: string, end: string | null) => {
  const s = new Date(start), dayFmt = new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short", year: s.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined });
  const t = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
  if (!end) return `${dayFmt.format(s)} · ${t.format(s)}`;
  const e = new Date(end);
  return s.toDateString() === e.toDateString() ? `${dayFmt.format(s)} · ${t.format(s)} – ${t.format(e)}` : `${dayFmt.format(s)} ${t.format(s)} – ${dayFmt.format(e)} ${t.format(e)}`;
};
function icsFor(d: EventData, id: string) {
  const z = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const esc = (s: string) => s.replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\n/g, "\\n");
  const end = d.endsAt ?? new Date(new Date(d.startsAt).getTime() + 3600_000).toISOString();
  return [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Office//Messages//EN", "BEGIN:VEVENT", `UID:${id}@office`, `DTSTAMP:${z(new Date().toISOString())}`,
    `DTSTART:${z(d.startsAt)}`, `DTEND:${z(end)}`, `SUMMARY:${esc(d.title)}`,
    ...(d.location ? [`LOCATION:${esc(d.location)}`] : []), ...(d.description ? [`DESCRIPTION:${esc(d.description)}`] : []),
    "END:VEVENT", "END:VCALENDAR",
  ].join("\r\n");
}

export function EventCard({ m, onChange }: { m: Message; onChange: (m: Message) => void }) {
  const host = useModuleHost();
  const d = m.data as unknown as EventData;
  const [busy, setBusy] = useState(false);
  const answer = async (a: "going" | "maybe" | "no") => {
    setBusy(true);
    try { onChange(await host.api.post<Message>(`/messages/${m.id}/answer`, { answer: a })); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };
  const past = new Date(d.endsAt ?? d.startsAt) < new Date();
  return (
    <div className="w-72 max-w-full overflow-hidden rounded-2xl border bg-surface text-foreground" role="group" aria-label={`Event: ${d.title}`}>
      <div className="flex gap-3 p-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-rose-500/15 text-rose-600 dark:text-rose-300"><CalendarDays className="size-5" /></span>
        <div className="min-w-0">
          <p className="break-words font-semibold">{d.title}</p>
          <p className={cn("text-xs", past ? "text-muted-foreground line-through" : "text-muted-foreground")}>{fmtEventTime(d.startsAt, d.endsAt)}</p>
          {d.location && <p className="mt-1 flex items-start gap-1 text-xs"><MapPin className="mt-0.5 size-3 shrink-0" /><span className="break-words">{d.location}</span></p>}
          {d.description && <p className="mt-1 whitespace-pre-wrap break-words text-xs text-muted-foreground">{d.description}</p>}
        </div>
      </div>
      <p className="px-3 pb-2 text-xs text-muted-foreground" title={[d.going.length ? `Going: ${d.going.join(", ")}` : "", d.maybe.length ? `Maybe: ${d.maybe.join(", ")}` : "", d.no.length ? `Can't go: ${d.no.join(", ")}` : ""].filter(Boolean).join("\n")}>
        {d.going.length} going · {d.maybe.length} maybe · {d.no.length} can't go
      </p>
      <div className="grid grid-cols-3 border-t text-xs font-medium" role="group" aria-label="Are you going?">
        {([["going", "Going"], ["maybe", "Maybe"], ["no", "Can't go"]] as const).map(([k, l]) => (
          <button key={k} type="button" disabled={busy} aria-pressed={d.myAnswer === k} onClick={() => void answer(k)}
            className={cn("cursor-pointer border-r py-2 last:border-r-0 hover:bg-accent", d.myAnswer === k && "bg-primary/10 text-primary")}>{l}</button>
        ))}
      </div>
      <button type="button" className="flex w-full cursor-pointer items-center justify-center gap-1.5 border-t py-2 text-xs text-primary hover:bg-accent"
        onClick={() => void saveBlob(new Blob([icsFor(d, m.id)], { type: "text/calendar" }), `${d.title.replace(/[^\w -]/g, "").slice(0, 60) || "event"}.ics`)}>
        <CalendarPlus className="size-3.5" /> Add to my calendar
      </button>
    </div>
  );
}

// ── Contact card ────────────────────────────────────────────────────────────
export function ContactCard({ m }: { m: Message }) {
  const host = useModuleHost();
  const d = m.data as unknown as ContactData;
  const [saved, setSaved] = useState(false);
  const save = async () => {
    const [firstName, ...rest] = d.name.split(/\s+/);
    try {
      await host.core.post("/contacts", { firstName: firstName ?? d.name, lastName: rest.join(" ") || null, email: d.email, phone: d.phone });
      setSaved(true); toast.success(`${d.name} saved to Contacts`);
    } catch (e) { toast.error(errorMessage(e)); }
  };
  return (
    <div className="w-64 max-w-full overflow-hidden rounded-2xl border bg-surface text-foreground" role="group" aria-label={`Contact: ${d.name}`}>
      <div className="flex items-center gap-3 p-3">
        <Avatar name={d.name} id={m.id} />
        <div className="min-w-0">
          <p className="truncate font-semibold">{d.name}</p>
          {(d.jobTitle || d.company) && <p className="truncate text-xs text-muted-foreground">{[d.jobTitle, d.company].filter(Boolean).join(" at ")}</p>}
        </div>
      </div>
      <div className="grid gap-1 px-3 pb-3 text-sm">
        {d.phone && <a className="flex items-center gap-2 hover:underline" href={`tel:${d.phone.replace(/[^\d+]/g, "")}`}><Phone className="size-3.5 text-muted-foreground" />{d.phone}</a>}
        {d.email && <a className="flex items-center gap-2 truncate hover:underline" href={`mailto:${d.email}`}><Mail className="size-3.5 shrink-0 text-muted-foreground" />{d.email}</a>}
      </div>
      {host.can("core:contacts.write") && (
        <button type="button" disabled={saved} onClick={() => void save()} className="flex w-full cursor-pointer items-center justify-center gap-1.5 border-t py-2 text-xs font-medium text-primary hover:bg-accent disabled:cursor-default disabled:text-muted-foreground">
          {saved ? <><Check className="size-3.5" /> Saved</> : <><UserPlus className="size-3.5" /> Save to Contacts</>}
        </button>
      )}
    </div>
  );
}
