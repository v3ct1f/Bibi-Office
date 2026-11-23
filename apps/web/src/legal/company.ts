/**
 * Who runs the service, as printed in the Terms and the Privacy Policy.
 * Fill in every value that is still in [SQUARE BRACKETS]. While any is left, the legal pages show a
 * "draft" warning, so incomplete text never looks final.
 */
export const COMPANY = {
  /** The name customers see. */
  service: "Bibi Office",
  /** Registered company name. */
  name: "[COMPANY NAME]",
  address: "[STREET AND NUMBER, POSTCODE, CITY]",
  country: "[COUNTRY]",
  /** Company number and VAT number. */
  registration: "[COMPANY NUMBER / VAT NUMBER]",
  /** Public contact for support and privacy requests. */
  email: "vectiff@gmail.com",
  /** Where the service runs once it is hosted (a processor named in the Privacy Policy). */
  hosting: "[HOSTING PROVIDER]",
  /** Country whose law governs the Terms, and whose courts decide disputes. */
  law: "[COUNTRY]",
  /** The data protection authority customers can complain to (e.g. in Belgium: the Gegevensbeschermingsautoriteit). */
  authority: "[DATA PROTECTION AUTHORITY]",
  /** Date of this text. Must equal TERMS_VERSION in apps/api/src/routes/billing.ts; change both when the text changes. */
  version: "2026-11-23",
  /** Days we keep a business's data after its subscription has ended. */
  keepDays: 90,
} as const;

export const legalIncomplete = Object.values(COMPANY).some((v) => typeof v === "string" && v.includes("["));
