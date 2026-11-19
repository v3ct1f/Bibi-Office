import { useState } from "react";
import { Card, CardContent, cn } from "@office/ui";
import { useSession } from "../lib/session.tsx";
import { Hosted } from "./host.tsx";
import { resolveSlots } from "./slot.tsx";

/** Host for `entity.tab:<type>` slots: tabs contributed by enabled modules. */
export function EntityTabs({ type, id, data, empty }: { type: string; id: string; data?: Record<string, unknown>; empty: string }) {
  const s = useSession();
  const tabs = resolveSlots(`entity.tab:${type}`, s.modules, s.permissions);
  const [tab, setTab] = useState(0);
  if (tabs.length === 0) return <Card><CardContent><p className="text-sm text-muted">{empty}</p></CardContent></Card>;
  const T = tabs[Math.min(tab, tabs.length - 1)]!;
  return (
    <Card>
      <div role="tablist" className="flex gap-1 overflow-x-auto border-b px-2">
        {tabs.map((t, i) => (
          <button key={`${t.module}-${i}`} role="tab" aria-selected={tab === i} onClick={() => setTab(i)}
            className={cn("whitespace-nowrap border-b-2 px-3 py-2 text-sm", tab === i ? "border-primary font-medium" : "border-transparent text-muted")}>{t.slot.label ?? t.module}</button>
        ))}
      </div>
      <div role="tabpanel" className="p-4">
        <Hosted key={`${T.module}-${T.slot.component}`} module={T.module} Component={T.Component} entity={{ type, id, ...(data ? { data } : {}) }} />
      </div>
    </Card>
  );
}
