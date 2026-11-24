/** Data regions a business can choose. Keep in step with packages/core/src/regions.ts (the API checks the key). */
export const REGIONS = [
  { key: "eu", label: "Europe (European Union)" },
  { key: "us", label: "North America" },
  { key: "sa", label: "South America" },
  { key: "asia", label: "Asia" },
  { key: "middle-east", label: "Middle East" },
  { key: "africa", label: "Africa" },
  { key: "oceania", label: "Oceania" },
] as const;
export const regionLabel = (key: string) => REGIONS.find((r) => r.key === key)?.label ?? key.toUpperCase();
/** Shown under the region field: honest about where data actually is today. */
export const REGION_HINT = "Your preferred region. For now all data is kept in the European Union.";
