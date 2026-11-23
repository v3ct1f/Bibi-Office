import { useEffect, useMemo, useState } from "react";
import { Search, UserMinus, UserPlus, Users } from "lucide-react";
import { Button, Checkbox, Dialog, DialogContent, DialogFooter, Field, Input, Tabs, TabsList, TabsTrigger, toast } from "@office/ui";
import { useModuleHost } from "@office/ui/module-ui";
import { Avatar, errorMessage, type Conversation, type Person } from "./shared.tsx";

function usePeople(open: boolean) {
  const host = useModuleHost();
  const [people, setPeople] = useState<Person[] | null>(null);
  useEffect(() => {
    if (!open || people) return;
    host.api.get<Person[]>("/people").then(setPeople).catch((e) => { toast.error(errorMessage(e)); setPeople([]); });
  }, [open, people, host]);
  return people;
}

function PeoplePicker({ people, exclude, selected, onToggle, onPick }: {
  people: Person[] | null; exclude?: Set<string>; selected?: Set<string>; onToggle?: (id: string) => void; onPick?: (p: Person) => void;
}) {
  const [q, setQ] = useState("");
  const list = useMemo(() => {
    const n = q.trim().toLowerCase();
    return (people ?? []).filter((p) => !exclude?.has(p.userId) && (!n || p.name.toLowerCase().includes(n) || p.email.toLowerCase().includes(n)));
  }, [people, q, exclude]);
  return (
    <div className="grid gap-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
        <Input aria-label="Search people" className="pl-8" placeholder="Search by name or email" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      </div>
      <ul className="max-h-72 overflow-y-auto rounded-md border" aria-label="People">
        {!people ? <li className="p-3 text-sm text-muted-foreground">Loading…</li>
          : !list.length ? <li className="p-3 text-sm text-muted-foreground">{people.length ? "Nobody matches." : "Nobody else is in this business yet. Invite colleagues in Colleagues."}</li>
          : list.map((p) => (
            <li key={p.userId}>
              {onPick ? (
                <button type="button" onClick={() => onPick(p)} className="flex w-full cursor-pointer items-center gap-3 px-3 py-2 text-left hover:bg-accent">
                  <Avatar name={p.name} id={p.userId} size="sm" />
                  <span className="min-w-0"><span className="block truncate text-sm font-medium">{p.name}</span><span className="block truncate text-xs text-muted-foreground">{p.email}</span></span>
                </button>
              ) : (
                <label className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-accent">
                  <Checkbox checked={!!selected?.has(p.userId)} onCheckedChange={() => onToggle?.(p.userId)} aria-label={p.name} />
                  <Avatar name={p.name} id={p.userId} size="sm" />
                  <span className="min-w-0"><span className="block truncate text-sm font-medium">{p.name}</span><span className="block truncate text-xs text-muted-foreground">{p.email}</span></span>
                </label>
              )}
            </li>
          ))}
      </ul>
    </div>
  );
}

const toggleIn = (s: Set<string>, id: string) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; };

/** "New chat": pick one person (direct chat) or several plus a name (group). */
export function NewChatDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: (c: Conversation) => void }) {
  const host = useModuleHost();
  const people = usePeople(open);
  const [tab, setTab] = useState<"person" | "group">("person");
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setTab("person"); setName(""); setPicked(new Set()); } }, [open]);

  const direct = async (p: Person) => {
    setBusy(true);
    try { onCreated(await host.api.post<Conversation>("/conversations/direct", { userId: p.userId })); onOpenChange(false); }
    catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };
  const group = async () => {
    if (!name.trim()) return toast.error("Give the group a name");
    if (!picked.size) return toast.error("Add at least one person");
    setBusy(true);
    try { onCreated(await host.api.post<Conversation>("/conversations/group", { name: name.trim(), memberIds: [...picked] })); onOpenChange(false); }
    catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="New chat">
        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
          <TabsList><TabsTrigger value="person">With one person</TabsTrigger><TabsTrigger value="group"><Users className="size-4" /> Group</TabsTrigger></TabsList>
        </Tabs>
        {tab === "person" ? <PeoplePicker people={people} onPick={(p) => { if (!busy) void direct(p); }} /> : (
          <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); void group(); }}>
            <Field label="Group name" required>{(a) => <Input {...a} value={name} onChange={(e) => setName(e.target.value)} maxLength={100} placeholder="e.g. Front desk team" />}</Field>
            <PeoplePicker people={people} selected={picked} onToggle={(id) => setPicked((s) => toggleIn(s, id))} />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit" loading={busy}>Create group{picked.size ? ` (${picked.size + 1} people)` : ""}</Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function RenameDialog({ conv, open, onOpenChange, onDone }: { conv: Conversation; open: boolean; onOpenChange: (o: boolean) => void; onDone: (c: Conversation) => void }) {
  const host = useModuleHost();
  const [name, setName] = useState(conv.name);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setName(conv.name); }, [open, conv.name]);
  const save = async () => {
    setBusy(true);
    try { onDone(await host.api.patch<Conversation>(`/conversations/${conv.id}`, { name: name.trim() })); onOpenChange(false); toast.success("Group renamed"); }
    catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Rename group">
        <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <Field label="Group name" required>{(a) => <Input {...a} value={name} onChange={(e) => setName(e.target.value)} maxLength={100} autoFocus />}</Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" loading={busy} disabled={!name.trim()}>Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Who's in the group: add people, remove them (managers), or leave. */
export function MembersDialog({ conv, open, onOpenChange, onChanged, onLeft }: {
  conv: Conversation; open: boolean; onOpenChange: (o: boolean) => void; onChanged: (c: Conversation) => void; onLeft: () => void;
}) {
  const host = useModuleHost();
  const people = usePeople(open);
  const [adding, setAdding] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setAdding(false); setPicked(new Set()); } }, [open]);
  const me = conv.members.find((m) => m.me)?.userId ?? null;
  const inGroup = useMemo(() => new Set(conv.members.map((m) => m.userId)), [conv.members]);
  const run = async (fn: () => Promise<void>) => { setBusy(true); try { await fn(); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); } };

  const add = () => run(async () => {
    onChanged(await host.api.post<Conversation>(`/conversations/${conv.id}/members`, { userIds: [...picked] }));
    toast.success(picked.size === 1 ? "Person added" : `${picked.size} people added`);
    setAdding(false); setPicked(new Set());
  });
  const remove = (userId: string, name: string) => run(async () => {
    onChanged(await host.api.del<Conversation>(`/conversations/${conv.id}/members/${userId}`));
    toast.success(`${name} removed`);
  });
  const leave = () => run(async () => {
    await host.api.del(`/conversations/${conv.id}/members/${me}`);
    toast.success(`You left “${conv.name}”`);
    onOpenChange(false); onLeft();
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={`People in “${conv.name}”`} description={`${conv.members.length} ${conv.members.length === 1 ? "person" : "people"}`}>
        {adding ? (
          <div className="grid gap-3">
            <PeoplePicker people={people} exclude={inGroup} selected={picked} onToggle={(id) => setPicked((s) => toggleIn(s, id))} />
            <DialogFooter>
              <Button variant="outline" onClick={() => setAdding(false)}>Back</Button>
              <Button loading={busy} disabled={!picked.size} onClick={() => void add()}>Add {picked.size || ""}</Button>
            </DialogFooter>
          </div>
        ) : (
          <>
            <ul className="grid max-h-80 gap-1 overflow-y-auto" aria-label="Group members">
              {conv.members.map((m) => (
                <li key={m.userId} className="flex items-center gap-3 rounded-md px-2 py-1.5">
                  <Avatar name={m.name} id={m.userId} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{m.name}{m.userId === me && " (you)"}</span>
                    <span className="block truncate text-xs text-muted-foreground">{m.role === "manager" ? "Group manager" : m.active ? m.email : "No longer in the business"}</span>
                  </span>
                  {conv.myRole === "manager" && m.userId !== me && (
                    <Button variant="ghost" size="sm" aria-label={`Remove ${m.name}`} disabled={busy} onClick={() => void remove(m.userId, m.name)}><UserMinus /> Remove</Button>
                  )}
                </li>
              ))}
            </ul>
            <DialogFooter className="sm:justify-between">
              <Button variant="ghost" className="text-destructive" disabled={busy} onClick={() => void leave()}>Leave group</Button>
              <Button onClick={() => setAdding(true)}><UserPlus /> Add people</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
