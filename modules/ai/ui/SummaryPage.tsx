import { useState } from "react";
import {
  ArrowLeft, Check, Copy, FileText, Handshake, Headphones, ListChecks, Lock, Mail, Pencil, Plus, RefreshCw, Trash2, User, X,
} from "lucide-react";
import {
  Button, Card, Checkbox, ConfirmDialog, Dialog, DialogContent, DialogFooter, ErrorState, Field, Input, Select, Skeleton, Textarea, toast,
} from "@office/ui";
import { useModuleHost, type PageProps } from "@office/ui/module-ui";
import { errorMessage, fmtDate, fmtDateTime, fmtNum, plural, useCopy, useLoad, type ActionItem, type Config, type Detail } from "./shared.tsx";

function Bullets({ title, items, label }: { title: string; items: string[]; label: string }) {
  if (!items.length) return null;
  return (
    <Card className="grid gap-2 p-4" role="group" aria-label={label}>
      <h2 className="font-semibold">{title}</h2>
      <ul className="grid list-disc gap-1 pl-5 text-sm">{items.map((t, i) => <li key={i}>{t}</li>)}</ul>
    </Card>
  );
}

/** Action items with checkboxes; picked ones become tasks. */
function ActionItems({ d, cfg, onChange }: { d: Detail; cfg: Config; onChange: (d: Detail) => void }) {
  const host = useModuleHost();
  const open = d.actionItems.filter((i) => !i.taskId);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(open.map((i) => i.id)));
  const [busy, setBusy] = useState(false);
  const canTask = cfg.canWrite && cfg.canCreateTasks;
  const chosen = open.filter((i) => picked.has(i.id));
  async function make() {
    setBusy(true);
    try {
      const r = await host.api.post<{ created: number; summary: Detail }>(`/summaries/${d.id}/tasks`, { itemIds: chosen.map((i) => i.id) });
      toast.success(`${plural(r.created, "task")} created`);
      onChange(r.summary); setPicked(new Set());
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  }
  return (
    <Card className="grid gap-3 p-4" role="group" aria-label="Action items">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-semibold"><ListChecks className="size-4" /> Action items</h2>
        {canTask && open.length > 0 && (
          <Button size="sm" loading={busy} disabled={!chosen.length} onClick={() => void make()}>
            <Plus /> {chosen.length ? `Create ${plural(chosen.length, "task")}` : "Create tasks"}
          </Button>
        )}
      </div>
      {!d.actionItems.length ? <p className="text-sm text-muted-foreground">No action items were found.</p> : (
        <ul className="grid gap-2">
          {d.actionItems.map((i) => (
            <li key={i.id} className="flex items-start gap-3 text-sm">
              {i.taskId
                ? <span className="mt-0.5 grid size-4 place-items-center rounded-sm bg-success text-white" title="Task created"><Check className="size-3" /></span>
                : canTask
                  ? <Checkbox className="mt-0.5" aria-label={i.text} checked={picked.has(i.id)}
                      onCheckedChange={(v) => { const n = new Set(picked); if (v) n.add(i.id); else n.delete(i.id); setPicked(n); }} />
                  : <span className="mt-0.5 size-4 rounded-sm border" />}
              <div className="min-w-0 flex-1">
                <p>{i.text}</p>
                <p className="text-xs text-muted-foreground">
                  {[i.ownerLabel ? `${i.ownerLabel}${i.ownerUserId ? "" : " (not in the team)"}` : "No owner", i.dueOn ? `due ${fmtDate(i.dueOn)}` : null].filter(Boolean).join(" · ")}
                  {i.taskId && <> · <a className="text-primary hover:underline" href={`/t/${host.tenant.slug}/tasks`}>Task created</a></>}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
      {cfg.canWrite && !cfg.canCreateTasks && open.length > 0 && <p className="text-xs text-muted-foreground">You aren't allowed to create tasks. Copy the items instead.</p>}
    </Card>
  );
}

function CopyButton({ id, text, label }: { id: string; text: string; label: string }) {
  const { copied, copy } = useCopy();
  return <Button size="sm" variant="outline" onClick={() => void copy(id, text)}>{copied === id ? <Check /> : <Copy />} {copied === id ? "Copied" : label}</Button>;
}

function FollowUp({ d }: { d: Detail }) {
  if (!d.followUpBody) return null;
  const emails = d.attendees.map((a) => a.email).filter(Boolean) as string[];
  const mailto = `mailto:${emails.map(encodeURIComponent).join(",")}?subject=${encodeURIComponent(d.followUpSubject ?? "")}&body=${encodeURIComponent(d.followUpBody)}`;
  return (
    <Card className="grid gap-3 p-4" role="group" aria-label="Follow-up email">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-semibold"><Mail className="size-4" /> Follow-up email</h2>
        <div className="flex gap-2">
          <CopyButton id="mail" text={`${d.followUpSubject ? `${d.followUpSubject}\n\n` : ""}${d.followUpBody}`} label="Copy" />
          <Button size="sm" variant="outline" asChild><a href={mailto.length < 1900 ? mailto : `mailto:${emails.join(",")}?subject=${encodeURIComponent(d.followUpSubject ?? "")}`}>Open in email app</a></Button>
        </div>
      </div>
      {d.followUpSubject && <p className="text-sm"><span className="text-muted-foreground">Subject:</span> {d.followUpSubject}</p>}
      <p className="whitespace-pre-wrap rounded-md bg-muted/50 p-3 text-sm">{d.followUpBody}</p>
      <p className="text-xs text-muted-foreground">{emails.length ? `To: ${emails.join(", ")}. ` : "Add attendees from the team to fill in their email addresses. "}Read it before sending.</p>
    </Card>
  );
}

function SuggestedReply({ d }: { d: Detail }) {
  const host = useModuleHost();
  if (!d.suggestedReply) return null;
  return (
    <Card className="grid gap-3 p-4" role="group" aria-label="Suggested reply">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-semibold"><Mail className="size-4" /> Suggested reply</h2>
        <div className="flex gap-2">
          <CopyButton id="reply" text={d.suggestedReply} label="Copy reply" />
          {d.sourceRef && <Button size="sm" variant="outline" asChild><a href={`/t/${host.tenant.slug}/m/support/support/${d.sourceRef}`}>Open ticket</a></Button>}
        </div>
      </div>
      <p className="whitespace-pre-wrap rounded-md bg-muted/50 p-3 text-sm">{d.suggestedReply}</p>
      <p className="text-xs text-muted-foreground">Check it before sending: Claude can be wrong.</p>
    </Card>
  );
}

// ── Editing ──────────────────────────────────────────────────────────────────
const toLines = (s: string) => s.split("\n").map((l) => l.replace(/^\s*[-•*]\s*/, "").trim()).filter(Boolean);
type ItemDraft = { id?: string; text: string; ownerUserId: string | null; ownerName: string | null; dueOn: string | null; locked: boolean };

function EditDialog({ d, cfg, open, onOpenChange, onSaved }: { d: Detail; cfg: Config; open: boolean; onOpenChange: (o: boolean) => void; onSaved: (d: Detail) => void }) {
  const host = useModuleHost();
  const [f, setF] = useState(() => ({
    title: d.title, summary: d.summary, keyPoints: d.keyPoints.join("\n"), decisions: d.decisions.join("\n"), openQuestions: d.openQuestions.join("\n"),
    followUpSubject: d.followUpSubject ?? "", followUpBody: d.followUpBody ?? "", suggestedReply: d.suggestedReply ?? "", meetingDate: d.meetingDate ?? "",
    visibility: d.visibility, contact: !!d.contactId, deal: !!d.dealId,
  }));
  const [items, setItems] = useState<ItemDraft[]>(() => d.actionItems.map((i: ActionItem) => ({ id: i.id, text: i.text, ownerUserId: i.ownerUserId, ownerName: i.ownerName, dueOn: i.dueOn, locked: !!i.taskId })));
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<typeof f>) => setF({ ...f, ...p });
  const setItem = (n: number, p: Partial<ItemDraft>) => setItems(items.map((x, j) => (j === n ? { ...x, ...p } : x)));
  async function save() {
    setBusy(true);
    try {
      const meeting = d.kind === "meeting";
      const r = await host.api.patch<Detail>(`/summaries/${d.id}`, {
        title: f.title, summary: f.summary, keyPoints: toLines(f.keyPoints),
        ...(meeting ? {
          decisions: toLines(f.decisions), openQuestions: toLines(f.openQuestions), meetingDate: f.meetingDate || null,
          followUpSubject: f.followUpSubject.trim() || null, followUpBody: f.followUpBody.trim() || null, visibility: f.visibility,
        } : { suggestedReply: f.suggestedReply.trim() || null }),
        ...(!f.contact && d.contactId ? { contactId: null } : {}),
        ...(!f.deal && d.dealId ? { dealId: null } : {}),
        actionItems: items.filter((i) => i.text.trim()).map((i) => ({ id: i.id, text: i.text.trim(), ownerUserId: i.ownerUserId, ownerName: i.ownerUserId ? null : i.ownerName, dueOn: i.dueOn || null })),
      });
      toast.success("Saved"); onSaved(r); onOpenChange(false);
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  }
  const lines = (label: string, key: "keyPoints" | "decisions" | "openQuestions") => (
    <Field label={label} hint="One per line">{(a) => <Textarea {...a} rows={4} value={f[key]} onChange={(e) => set({ [key]: e.target.value })} />}</Field>
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Edit summary" wide>
        <div className="grid max-h-[70vh] gap-3 overflow-y-auto pr-1">
          <Field label="Name">{(a) => <Input {...a} value={f.title} maxLength={200} onChange={(e) => set({ title: e.target.value })} />}</Field>
          {d.kind === "meeting" && <Field label="Date">{(a) => <Input {...a} type="date" value={f.meetingDate} onChange={(e) => set({ meetingDate: e.target.value })} />}</Field>}
          <Field label="Summary">{(a) => <Textarea {...a} rows={6} value={f.summary} onChange={(e) => set({ summary: e.target.value })} />}</Field>
          {lines("Key points", "keyPoints")}
          {d.kind === "meeting" && <>{lines("Decisions", "decisions")}{lines("Open questions", "openQuestions")}</>}
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">Action items</legend>
            {items.map((i, n) => (
              <div key={i.id ?? `new-${n}`} className="grid gap-2 rounded-md border p-2 sm:grid-cols-[1fr_10rem_9rem_auto]" role="group" aria-label={`Action item ${n + 1}`}>
                <Input aria-label="What" value={i.text} disabled={i.locked} maxLength={500} onChange={(e) => setItem(n, { text: e.target.value })} />
                <Select aria-label="Owner" disabled={i.locked} value={i.ownerUserId ?? ""} onChange={(e) => setItem(n, { ownerUserId: e.target.value || null })}>
                  <option value="">{i.ownerName && !i.ownerUserId ? `${i.ownerName} (not in team)` : "No owner"}</option>
                  {cfg.people.map((p) => <option key={p.userId} value={p.userId}>{p.name}</option>)}
                </Select>
                <Input aria-label="Due" type="date" disabled={i.locked} value={i.dueOn ?? ""} onChange={(e) => setItem(n, { dueOn: e.target.value || null })} />
                {i.locked ? <span className="self-center text-xs text-muted-foreground">Task</span>
                  : <Button size="icon" variant="ghost" aria-label="Remove action item" onClick={() => setItems(items.filter((_, j) => j !== n))}><X /></Button>}
              </div>
            ))}
            <Button size="sm" variant="outline" className="justify-self-start" disabled={items.length >= 30}
              onClick={() => setItems([...items, { text: "", ownerUserId: null, ownerName: null, dueOn: null, locked: false }])}><Plus /> Add action item</Button>
          </fieldset>
          {d.kind === "meeting" ? <>
            <Field label="Follow-up email subject">{(a) => <Input {...a} value={f.followUpSubject} maxLength={300} onChange={(e) => set({ followUpSubject: e.target.value })} />}</Field>
            <Field label="Follow-up email">{(a) => <Textarea {...a} rows={6} value={f.followUpBody} onChange={(e) => set({ followUpBody: e.target.value })} />}</Field>
            <Field label="Who can see it">{(a) => (
              <Select {...a} value={f.visibility} onChange={(e) => set({ visibility: e.target.value as "team" | "private" })}>
                <option value="team">Everyone in the team</option><option value="private">Only me (and managers)</option>
              </Select>
            )}</Field>
          </> : <Field label="Suggested reply">{(a) => <Textarea {...a} rows={6} value={f.suggestedReply} onChange={(e) => set({ suggestedReply: e.target.value })} />}</Field>}
          {(d.contactId || d.dealId) && (
            <div className="grid gap-1 text-sm">
              {d.contactId && <label className="flex items-center gap-2"><Checkbox checked={f.contact} onCheckedChange={(v) => set({ contact: !!v })} /> Linked to {d.contactName ?? "a contact"}</label>}
              {d.dealId && <label className="flex items-center gap-2"><Checkbox checked={f.deal} onCheckedChange={(v) => set({ deal: !!v })} /> Linked to a deal</label>}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button loading={busy} disabled={!f.title.trim() || !f.summary.trim()} onClick={() => void save()}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function SummaryPage({ params }: PageProps) {
  const host = useModuleHost();
  const id = params.id!;
  const cfg = useLoad(() => host.api.get<Config>("/config"), [host]);
  const s = useLoad(() => host.api.get<Detail>(`/summaries/${id}`), [host, id]);
  const [dialog, setDialog] = useState<"edit" | "redo" | "delete" | null>(null);
  const back = (
    <Button variant="ghost" size="sm" className="mb-2 -ml-2" onClick={() => host.navigate(s.data?.kind === "ticket" ? "/ai/tickets" : "/ai")}><ArrowLeft /> Summaries</Button>
  );
  if (s.error) return <>{back}<Card><ErrorState title="Can't open this summary" error={s.error} onRetry={() => void s.reload()} /></Card></>;
  if (!s.data || !cfg.data) return <>{back}<Skeleton className="h-96" /></>;
  const d = s.data, c = cfg.data;
  const slug = host.tenant.slug;
  return (
    <>
      {back}
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight">{d.title}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
            {d.kind === "meeting" ? <>Meeting{d.meetingDate ? ` on ${fmtDate(d.meetingDate)}` : ""}</> : <>Support ticket</>}
            <span>· by {d.createdByName ?? "someone"}, {fmtDateTime(d.createdAt)}</span>
            {d.edited && <span>· edited</span>}
            {d.visibility === "private" && <span className="inline-flex items-center gap-1">· <Lock className="size-3.5" /> only you</span>}
          </p>
        </div>
        {d.canEdit && (
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" className="text-destructive" onClick={() => setDialog("delete")}><Trash2 /> Delete</Button>
            {c.canWrite && c.ready && <Button variant="outline" onClick={() => setDialog("redo")}><RefreshCw /> Summarise again</Button>}
            <Button variant="outline" onClick={() => setDialog("edit")}><Pencil /> Edit</Button>
          </div>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <div className="grid min-w-0 content-start gap-4">
          <Card className="grid gap-2 p-4" role="group" aria-label="Summary">
            <h2 className="font-semibold">Summary</h2>
            <p className="whitespace-pre-wrap text-sm">{d.summary}</p>
          </Card>
          <Bullets title="Key points" label="Key points" items={d.keyPoints} />
          <Bullets title="Decisions" label="Decisions" items={d.decisions} />
          <ActionItems key={d.updatedAt + d.actionItems.map((i) => i.taskId ?? "").join()} d={d} cfg={c} onChange={(x) => s.set(x)} />
          <Bullets title="Open questions" label="Open questions" items={d.openQuestions} />
          <FollowUp d={d} />
          <SuggestedReply d={d} />
        </div>

        <aside className="grid content-start gap-4 text-sm">
          <Card className="grid gap-2 p-4">
            <h2 className="font-semibold">Details</h2>
            {d.attendees.length > 0 && <div><p className="text-xs text-muted-foreground">Who was there</p><p>{d.attendees.map((a) => a.name).join(", ")}</p></div>}
            {d.contactId && <a className="inline-flex items-center gap-1.5 hover:underline" href={`/t/${slug}/contacts/${d.contactId}`}><User className="size-3.5" />{d.contactName ?? "Contact"}</a>}
            {d.dealId && <a className="inline-flex items-center gap-1.5 hover:underline" href={`/t/${slug}/m/crm/deals/${d.dealId}`}><Handshake className="size-3.5" />Open the deal</a>}
            {d.sourceRef && <a className="inline-flex items-center gap-1.5 hover:underline" href={`/t/${slug}/m/support/support/${d.sourceRef}`}><Headphones className="size-3.5" />{d.sourceLabel ?? "Open the ticket"}</a>}
            <p className="text-xs text-muted-foreground">Made by {d.model} · {fmtNum(d.inputTokens + d.outputTokens)} tokens</p>
          </Card>
          <Card className="p-4">
            <details>
              <summary className="flex cursor-pointer items-center gap-2 font-semibold"><FileText className="size-4" /> {d.kind === "meeting" ? "Original notes" : "Conversation that was summarised"}</summary>
              <p className="mt-2 text-xs text-muted-foreground">{d.sourceName ? `${d.sourceName} · ` : ""}{fmtNum(d.sourceChars)} characters</p>
              <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/50 p-2 font-sans text-xs">{d.sourceText}</pre>
            </details>
          </Card>
        </aside>
      </div>

      {dialog === "edit" && <EditDialog d={d} cfg={c} open onOpenChange={(o) => !o && setDialog(null)} onSaved={(x) => s.set(x)} />}
      <ConfirmDialog open={dialog === "redo"} onOpenChange={(o) => !o && setDialog(null)} confirmLabel="Summarise again" title="Summarise again?"
        description="Claude reads the same text again and replaces the summary, key points and action items. Your edits are lost. Action items already turned into tasks are kept."
        onConfirm={async () => {
          try { s.set(await host.api.post<Detail>(`/summaries/${d.id}/regenerate`, { companyName: host.tenant.name })); toast.success("Summary updated"); }
          catch (e) { toast.error(errorMessage(e)); throw e; }
        }} />
      <ConfirmDialog open={dialog === "delete"} onOpenChange={(o) => !o && setDialog(null)} destructive confirmLabel="Delete summary" title="Delete this summary?"
        description="The summary, its action items and the saved notes are removed. Tasks already created stay in Tasks."
        onConfirm={async () => {
          try { await host.api.del(`/summaries/${d.id}`); toast.success("Summary deleted"); host.navigate(d.kind === "ticket" ? "/ai/tickets" : "/ai"); }
          catch (e) { toast.error(errorMessage(e)); throw e; }
        }} />
    </>
  );
}
