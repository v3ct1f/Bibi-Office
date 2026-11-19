import { Client, Connection, WorkflowIdReusePolicy } from "@temporalio/client";
import { eq } from "drizzle-orm";
import { withTenant, workflowRuns } from "@office/db";
import { executeStep, finishRun, type ExecDeps, type RunRef } from "./engine.ts";

export interface WorkflowRunner { start(run: RunRef): Promise<void> }

const markRunning = (d: ExecDeps, r: RunRef, engineRunId?: string) =>
  withTenant(d.db, r.tenantId, (tx) => tx.update(workflowRuns)
    .set({ status: "running", ...(engineRunId ? { engineRunId } : {}) }).where(eq(workflowRuns.id, r.runId)));

/**
 * In-process runner for dev/tests and small installs: sequential steps, 3 attempts with backoff.
 * No durable timers: workflows with core.wait fail here and need Temporal.
 */
export class InlineRunner implements WorkflowRunner {
  constructor(private d: ExecDeps, private backoffMs = 200) {}
  async start(r: RunRef) {
    await markRunning(this.d, r);
    if (r.steps.some((s) => s.key === "core.wait")) {
      await finishRun(this.d, r.tenantId, r.runId, "failed", "core.wait requires the Temporal runner");
      return;
    }
    for (let i = 0; i < r.steps.length; i++) {
      let lastErr: unknown;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try { await executeStep(this.d, r.tenantId, r.runId, i); lastErr = undefined; break; }
        catch (e) { lastErr = e; if (attempt < 3) await new Promise((res) => setTimeout(res, this.backoffMs * 2 ** attempt)); }
      }
      if (lastErr) { await finishRun(this.d, r.tenantId, r.runId, "failed", `step ${i + 1}: ${(lastErr as Error).message}`); return; }
    }
    await finishRun(this.d, r.tenantId, r.runId, "succeeded");
  }
}

export const TASK_QUEUE = "office-workflows";

/** Durable runner: one Temporal workflow per run; Temporal handles retries, timers, crashes. */
export class TemporalRunner implements WorkflowRunner {
  private constructor(private d: ExecDeps, private client: Client) {}
  static async connect(d: ExecDeps, address: string, namespace = "default") {
    const connection = await Connection.connect({ address });
    return new TemporalRunner(d, new Client({ connection, namespace }));
  }
  async start(r: RunRef) {
    const h = await this.client.workflow.start("officeWorkflow", {
      taskQueue: TASK_QUEUE, workflowId: `office-run-${r.runId}`, args: [r],
      workflowIdReusePolicy: WorkflowIdReusePolicy.REJECT_DUPLICATE,
    }).catch((e: Error) => { if (e.name === "WorkflowExecutionAlreadyStartedError") return null; throw e; });
    if (h) await markRunning(this.d, r, h.firstExecutionRunId);
  }
}

/** Activities registered on the Temporal worker (apps/worker). */
export const temporalActivities = (d: ExecDeps) => ({
  runStep: (tenantId: string, runId: string, index: number) => executeStep(d, tenantId, runId, index).then(() => undefined),
  finishRun: (tenantId: string, runId: string, status: "succeeded" | "failed", error?: string) => finishRun(d, tenantId, runId, status, error),
});
export type TemporalActivities = ReturnType<typeof temporalActivities>;
