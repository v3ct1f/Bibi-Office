// Vite asset URL imports (the pdf.js worker).
declare module "*?url" {
  const src: string;
  export default src;
}
