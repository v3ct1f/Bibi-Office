import { metric, flowSum, type MetricSpec } from "@office/sdk";
import { sql } from "drizzle-orm";

export const metrics: Record<string, MetricSpec> = {
  "scheduling.bookings": metric({
    label: "Bookings", description: "Appointments in the period (cancelled ones left out).", permission: "scheduling:booking.read", unit: "count", kind: "flow",
    compute: (ctx, r) => flowSum(ctx, r, { from: "scheduling_bookings", at: "starts_at", value: "1", where: sql`status <> 'cancelled'` }),
  }),
};
