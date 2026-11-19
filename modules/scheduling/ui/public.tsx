import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Alert, Button, Card, CardContent, Field, Input, Spinner, Textarea, cn } from "@office/ui";
import type { PublicPageProps } from "@office/sdk/ui";
import { addDays, byDay, fmtDayLong, fmtDayShort, fmtTime, fmtWhen, localDate } from "./common.tsx";
import type { PublicBooking, PublicInfo, Slot } from "./types.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function Frame({ title, children, back }: { title: string; children: React.ReactNode; back?: () => void }) {
  return (
    <main className="min-h-dvh bg-bg">
      <div className="mx-auto grid max-w-2xl gap-5 px-4 py-8 sm:py-12">
        {back && <button type="button" onClick={back} className="justify-self-start text-sm text-primary hover:underline">← Back</button>}
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {children}
      </div>
    </main>
  );
}

/** /p/<tenant>/scheduling/book[/<service>] and /book/booking/<id>#<token> */
export function BookingPage(props: PublicPageProps) {
  const seg = props.subPath.split("/").filter(Boolean);
  if (seg[0] === "booking" && seg[1] && UUID.test(seg[1])) return <ManageBooking {...props} id={seg[1]} />;
  if (seg[0]) return <ServiceBooking {...props} slug={seg[0]} />;
  return <ServiceList {...props} />;
}

const useInfo = ({ api, tenantSlug }: PublicPageProps) =>
  useQuery({ queryKey: ["public", tenantSlug, "scheduling", "info"], queryFn: () => api.get<PublicInfo>("/info"), retry: false });

function ServiceList(props: PublicPageProps) {
  const q = useInfo(props);
  if (q.isPending) return <Frame title="Book an appointment"><Spinner /></Frame>;
  if (q.isError) return <Frame title="Booking unavailable"><Alert tone="warning">This booking page is not available.</Alert></Frame>;
  const i = q.data;
  return (
    <Frame title={i.title || "Book an appointment"}>
      {i.services.length === 0 ? <p className="text-muted">Nothing can be booked online right now.</p> : (
        <ul className="grid gap-3">
          {i.services.map((s) => (
            <li key={s.slug}>
              <a href={`book/${s.slug}`} onClick={(e) => { e.preventDefault(); props.navigate(`/book/${s.slug}`); }}
                className="grid gap-1 rounded-lg border bg-surface p-4 shadow-sm hover:border-primary">
                <span className="flex items-baseline justify-between gap-3"><span className="font-medium">{s.name}</span><span className="text-sm text-muted">{s.durationMin} min</span></span>
                {s.description && <span className="text-sm text-muted">{s.description}</span>}
                {s.location && <span className="text-sm text-muted">{s.location}</span>}
              </a>
            </li>
          ))}
        </ul>
      )}
    </Frame>
  );
}

function ServiceBooking(props: PublicPageProps & { slug: string }) {
  const { api, tenantSlug, slug, errorMessage, navigate } = props;
  const info = useInfo(props);
  const svc = info.data?.services.find((s) => s.slug === slug);
  const tz = info.data?.timezone ?? "UTC";
  const today = localDate(new Date(), tz);
  const [from, setFrom] = useState(today);
  const to = addDays(from, 6);
  const slots = useQuery({
    queryKey: ["public", tenantSlug, "scheduling", "slots", slug, from], enabled: !!svc,
    queryFn: () => api.get<{ timezone: string; data: Slot[] }>(`/services/${slug}/slots?from=${from}&to=${to}`),
  });
  const days = useMemo(() => byDay(slots.data?.data ?? [], tz), [slots.data, tz]);
  const [day, setDay] = useState<string | null>(null);
  const [pick, setPick] = useState<Slot | null>(null);
  useEffect(() => { setDay(slots.data ? ([...days.keys()][0] ?? null) : null); setPick(null); }, [slots.data, days]);
  const [f, setF] = useState({ name: "", email: "", phone: "", notes: "", website: "" });
  const book = useMutation({
    mutationFn: () => api.post<PublicBooking>(`/services/${slug}/book`, {
      start: pick!.start, name: f.name, email: f.email, ...(f.phone ? { phone: f.phone } : {}), ...(f.notes ? { notes: f.notes } : {}), ...(f.website ? { website: f.website } : {}),
    }),
    onSuccess: (b) => {
      try { sessionStorage.setItem(`booking.${b.id}`, b.token ?? ""); } catch { /* ignore */ }
      navigate(`/book/booking/${b.id}#${b.token}`);
    },
    onError: () => void slots.refetch(),
  });
  if (info.isPending) return <Frame title="Book an appointment"><Spinner /></Frame>;
  if (info.isError || !svc) return <Frame title="Not found" back={() => navigate("/book")}><Alert tone="warning">This service can't be booked online.</Alert></Frame>;
  return (
    <Frame title={svc.name} back={() => navigate("/book")}>
      <p className="-mt-3 text-sm text-muted">{svc.durationMin} min{svc.location ? ` · ${svc.location}` : ""}. Times are in {tz.replace(/_/g, " ")}.</p>
      {!pick ? (
        <Card><CardContent className="grid gap-4 pt-5">
          <div className="flex items-center justify-between gap-2">
            <Button variant="outline" size="sm" disabled={from <= today} onClick={() => setFrom(addDays(from, -7))} aria-label="Earlier dates">←</Button>
            <span className="text-sm font-medium">{fmtDayShort(from)} – {fmtDayShort(to)}</span>
            <Button variant="outline" size="sm" onClick={() => setFrom(addDays(from, 7))} aria-label="Later dates">→</Button>
          </div>
          {slots.isPending ? <Spinner label="Loading times" /> : slots.isError ? <Alert>{errorMessage(slots.error)}</Alert> : days.size === 0 ? (
            <p className="text-sm text-muted">No free times this week. Try the next week.</p>
          ) : (
            <>
              <div role="tablist" aria-label="Day" className="flex flex-wrap gap-2">
                {[...days.keys()].map((d) => (
                  <Button key={d} role="tab" aria-selected={d === day} size="sm" variant={d === day ? "primary" : "outline"} className={d === day ? "ring-2 ring-primary ring-offset-1" : ""} onClick={() => setDay(d)}>{fmtDayShort(d)}</Button>
                ))}
              </div>
              {day && (
                <div className="grid gap-2">
                  <h2 className="text-sm font-medium">{fmtDayLong(day)}</h2>
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                    {days.get(day)!.map((s) => <Button key={s.start} variant="outline" onClick={() => setPick(s)}>{fmtTime(s.start, tz)}</Button>)}
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent></Card>
      ) : (
        <Card><CardContent className="grid gap-4 pt-5">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-primary/10 px-3 py-2 text-sm">
            <span className="font-medium">{fmtWhen(pick.start, tz)} – {fmtTime(pick.end, tz)}</span>
            <button type="button" className="text-primary hover:underline" onClick={() => setPick(null)}>Change time</button>
          </div>
          <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); book.mutate(); }}>
            {book.error && <Alert>{errorMessage(book.error)}</Alert>}
            <Field label="Your name">{(a) => <Input {...a} required autoComplete="name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field>
            <Field label="Email" hint="We use it only for this booking.">{(a) => <Input {...a} type="email" required autoComplete="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />}</Field>
            <Field label="Phone (optional)">{(a) => <Input {...a} type="tel" autoComplete="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />}</Field>
            <Field label="Anything we should know? (optional)">{(a) => <Textarea {...a} rows={3} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />}</Field>
            <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
              <label>Website<input tabIndex={-1} autoComplete="off" value={f.website} onChange={(e) => setF({ ...f, website: e.target.value })} /></label>
            </div>
            <Button type="submit" disabled={book.isPending}>{book.isPending ? "Booking…" : "Confirm booking"}</Button>
          </form>
        </CardContent></Card>
      )}
    </Frame>
  );
}

function ManageBooking(props: PublicPageProps & { id: string }) {
  const { api, tenantSlug, id, errorMessage, navigate } = props;
  const token = useMemo(() => {
    const h = typeof window !== "undefined" ? window.location.hash.slice(1) : "";
    if (h) return h;
    try { return sessionStorage.getItem(`booking.${id}`) ?? ""; } catch { return ""; }
  }, [id]);
  const info = useInfo(props);
  const tz = info.data?.timezone ?? "UTC";
  const q = useQuery({
    queryKey: ["public", tenantSlug, "scheduling", "booking", id], enabled: !!token, retry: false,
    queryFn: () => api.get<PublicBooking>(`/bookings/${id}?token=${encodeURIComponent(token)}`),
  });
  const [confirming, setConfirming] = useState(false);
  const cancel = useMutation({ mutationFn: () => api.post<PublicBooking>(`/bookings/${id}/cancel`, { token }), onSuccess: () => void q.refetch() });
  const [copied, setCopied] = useState(false);
  if (!token || q.isError) return <Frame title="Booking not found"><Alert tone="warning">This link is not valid. Use the link from your booking confirmation.</Alert></Frame>;
  if (q.isPending) return <Frame title="Your booking"><Spinner /></Frame>;
  const b = q.data, cancelled = b.status === "cancelled";
  return (
    <Frame title={cancelled ? "Booking cancelled" : "You're booked"}>
      <Card><CardContent className="grid gap-2 pt-5">
        <p className="text-lg font-medium">{b.service}</p>
        <p className={cn("tabular-nums", cancelled && "line-through text-muted")}>{fmtWhen(b.startsAt, tz)} – {fmtTime(b.endsAt, tz)} <span className="text-sm text-muted">({tz.replace(/_/g, " ")})</span></p>
        {b.location && <p className="text-sm text-muted">{b.location}</p>}
        <p className="text-sm text-muted">For {b.name}</p>
      </CardContent></Card>
      {!cancelled && (
        <div className="grid gap-3">
          <Alert tone="success">Keep this page's link to view or cancel your booking.</Alert>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => { void navigator.clipboard?.writeText(window.location.href).then(() => setCopied(true)); }}>{copied ? "Link copied" : "Copy link"}</Button>
            {!confirming ? <Button variant="ghost" onClick={() => setConfirming(true)}>Cancel booking</Button> : (
              <Button variant="danger" disabled={cancel.isPending} onClick={() => cancel.mutate()}>Yes, cancel it</Button>
            )}
          </div>
          {cancel.error && <Alert>{errorMessage(cancel.error)}</Alert>}
        </div>
      )}
      {cancelled && <Button variant="outline" onClick={() => navigate("/book")}>Book another time</Button>}
    </Frame>
  );
}
