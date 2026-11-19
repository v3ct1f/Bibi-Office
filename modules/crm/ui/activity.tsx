import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Badge, Button, Field, Input, Select, Spinner, Textarea, cn } from "@office/ui";
import type { SlotProps } from "@office/sdk/ui";
import { fmtWhen, P } from "./common.tsx";
import type { Activity } from "./types.ts";

const TYPES = [["note", "Note"], ["call", "Call"], ["email", "Email"], ["meeting", "Meeting"], ["task", "Task"]] as const;

/** Activity timeline + quick-add form, filtered by deal, contact or company. */
export function Timeline({ api, tenantId, can, errorMessage, filter }: Pick<SlotProps, "api" | "tenantId" | "can" | "errorMessage"> & { filter: { dealId?: string; contactId?: string; companyId?: string } }) {
  const qc = useQueryClient();
  const qs = new URLSearchParams(filter as Record<string, string>).toString();
  const key = ["tenant", tenantId, "crm", "activities", filter];
  const q = useQuery({ queryKey: key, queryFn: () => api.get<{ data: Activity[] }>(`/activities?${qs}`) });
  const [type, setType] = useState<Activity["type"]>("note");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [due, setDue] = useState("");
  const refresh = () => qc.invalidateQueries({ queryKey: ["tenant", tenantId, "crm"] });
  const add = useMutation({
    mutationFn: () => api.post("/activities", {
      type, subject, ...filter, ...(body.trim() ? { body } : {}), ...(type === "task" && due ? { dueAt: new Date(due).toISOString() } : {}),
    }),
    onSuccess: async () => { setSubject(""); setBody(""); setDue(""); await refresh(); },
  });
  const toggle = useMutation({ mutationFn: (a: Activity) => api.patch(`/activities/${a.id}`, { done: !a.doneAt }), onSuccess: refresh });
  return (
    <div className="grid gap-4">
      {can(P.activity) && (
        <form className="grid gap-2 rounded-md border p-3" onSubmit={(e) => { e.preventDefault(); if (subject.trim()) add.mutate(); }}>
          {add.error && <Alert>{errorMessage(add.error)}</Alert>}
          <div className="grid gap-2 sm:grid-cols-[8rem_1fr]">
            <Field label="Type">{(a) => (
              <Select {...a} value={type} onChange={(e) => setType(e.target.value as Activity["type"])}>
                {TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </Select>
            )}</Field>
            <Field label="Subject">{(a) => <Input {...a} value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="What happened or what's next?" />}</Field>
          </div>
          <Field label="Details (optional)">{(a) => <Textarea {...a} rows={2} value={body} onChange={(e) => setBody(e.target.value)} />}</Field>
          <div className="flex flex-wrap items-end gap-2">
            {type === "task" && <Field label="Due">{(a) => <Input {...a} type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} />}</Field>}
            <Button type="submit" size="sm" disabled={add.isPending || !subject.trim()}>{type === "task" ? "Add task" : "Log activity"}</Button>
          </div>
        </form>
      )}
      {q.isPending ? <Spinner /> : q.isError ? <Alert>{errorMessage(q.error)}</Alert> : q.data.data.length === 0 ? (
        <p className="text-sm text-muted">No activity yet.</p>
      ) : (
        <ol className="grid gap-3" aria-label="Activity">
          {q.data.data.map((a) => (
            <li key={a.id} className="flex gap-3 text-sm">
              {a.type === "task" ? (
                <input type="checkbox" className="mt-1 size-4 accent-[var(--primary)]" aria-label={`Done: ${a.subject}`} checked={!!a.doneAt}
                  disabled={!can(P.activity) || toggle.isPending} onChange={() => toggle.mutate(a)} />
              ) : <span aria-hidden className="mt-1.5 size-2 shrink-0 rounded-full bg-primary/60" />}
              <div className="grid gap-0.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={cn("font-medium", a.type === "task" && a.doneAt && "text-muted line-through")}>{a.subject}</span>
                  <Badge>{TYPES.find(([v]) => v === a.type)?.[1]}</Badge>
                  {a.overdue && <Badge tone="danger">Overdue</Badge>}
                </div>
                {a.body && <p className="whitespace-pre-wrap text-muted">{a.body}</p>}
                <span className="text-xs text-muted">{a.dueAt && !a.doneAt ? `Due ${fmtWhen(a.dueAt)}` : fmtWhen(a.createdAt)}</span>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
