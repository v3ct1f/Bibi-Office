// Temporal workflow code: deterministic sandbox. Import only types + @temporalio/workflow here.
import { proxyActivities, sleep, ApplicationFailure } from "@temporalio/workflow";
import type { TemporalActivities } from "./runners.ts";
import type { RunRef } from "./engine.ts";

const { runStep } = proxyActivities<TemporalActivities>({
  startToCloseTimeout: "2 minutes",
  retry: { initialInterval: "5s", backoffCoefficient: 2, maximumInterval: "10m", maximumAttempts: 8 },
});
const { finishRun } = proxyActivities<TemporalActivities>({ startToCloseTimeout: "30s", retry: { maximumAttempts: 20 } });

export async function officeWorkflow(run: RunRef): Promise<void> {
  try {
    for (let i = 0; i < run.steps.length; i++) {
      const s = run.steps[i]!;
      if (s.key === "core.wait") await sleep((s.seconds ?? 0) * 1000);
      await runStep(run.tenantId, run.runId, i);
    }
    await finishRun(run.tenantId, run.runId, "succeeded");
  } catch (e) {
    const msg = e instanceof ApplicationFailure ? e.message : String((e as Error)?.message ?? e);
    await finishRun(run.tenantId, run.runId, "failed", msg);
  }
}
