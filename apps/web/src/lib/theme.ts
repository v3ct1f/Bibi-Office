export type Theme = "light" | "dark" | "system";
const KEY = "office.theme";
export function getTheme(): Theme { try { return (localStorage.getItem(KEY) as Theme) || "system"; } catch { return "system"; } }
export function applyTheme(t: Theme) {
  if (t === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", t);
  try { localStorage.setItem(KEY, t); } catch { /* ignore */ }
}
