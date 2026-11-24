/**
 * Data regions a business can choose. The key is what `tenants.region` stores; "us" stays the key for
 * North America because businesses created before this list already store it. Keep this list the same as
 * apps/web/src/lib/regions.ts (the web app can't import server code).
 * Today every business is hosted on the one EU server; the region records the owner's choice for later.
 */
export const REGIONS = [
  { key: "eu", label: "Europe (European Union)" },
  { key: "us", label: "North America" },
  { key: "sa", label: "South America" },
  { key: "asia", label: "Asia" },
  { key: "middle-east", label: "Middle East" },
  { key: "africa", label: "Africa" },
  { key: "oceania", label: "Oceania" },
] as const;
export type Region = (typeof REGIONS)[number]["key"];
export const REGION_KEYS = REGIONS.map((r) => r.key) as [Region, ...Region[]];
