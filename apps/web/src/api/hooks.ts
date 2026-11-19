import { useMutation, useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { toast } from "@office/ui";
import { useTenant } from "../lib/tenant.tsx";
import { errorMessage } from "./client.ts";

/** Tenant-scoped GET; key is namespaced by tenant so switching tenants never mixes caches. */
export function useTQuery<T>(key: QueryKey, path: string, query?: Record<string, string | number | boolean | undefined>, opts: { enabled?: boolean } = {}) {
  const { api, tenant } = useTenant();
  return useQuery({
    queryKey: ["t", tenant.id, ...key, query ?? {}],
    queryFn: () => api.get<T>(path, query),
    enabled: opts.enabled ?? true,
  });
}

/** Mutation that toasts on success/error and invalidates the given tenant-scoped keys. */
export function useTMutation<V, R = unknown>(fn: (v: V) => Promise<R>, o: { invalidate?: QueryKey[]; success?: string | ((r: R, v: V) => string | undefined); onSuccess?: (r: R, v: V) => void } = {}) {
  const qc = useQueryClient();
  const { tenant } = useTenant();
  return useMutation({
    mutationFn: fn,
    onSuccess: async (r, v) => {
      await Promise.all((o.invalidate ?? []).map((k) => qc.invalidateQueries({ queryKey: ["t", tenant.id, ...k] })));
      const msg = typeof o.success === "function" ? o.success(r, v) : o.success;
      if (msg) toast.success(msg);
      o.onSuccess?.(r, v);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
}
