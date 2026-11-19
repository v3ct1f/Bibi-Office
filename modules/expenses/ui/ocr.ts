/**
 * Receipt photos: shrink in the browser, then read the text with Tesseract (runs locally in a web worker,
 * nothing is sent to a third party). The app serves the OCR engine and English + Spanish language data under /ocr/
 * (see apps/web/vite.config.ts), so it also works without internet access to a CDN.
 */
import { createWorker, type Worker } from "tesseract.js";

const MAX_SIDE = 2000;

export interface PreparedFile { name: string; contentType: string; base64: string; bytes: number; previewUrl: string; isImage: boolean }

const readAsDataUrl = (b: Blob) => new Promise<string>((res, rej) => {
  const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(r.error); r.readAsDataURL(b);
});

/** Images are resized to at most 2000px and re-encoded as JPEG (keeps uploads small, OCR reads them fine). PDFs are kept as is. */
export async function prepareFile(file: File): Promise<PreparedFile> {
  if (file.type === "application/pdf") {
    const url = await readAsDataUrl(file);
    return { name: file.name, contentType: file.type, base64: url.split(",")[1]!, bytes: file.size, previewUrl: url, isImage: false };
  }
  if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(file.type) && !file.type.startsWith("image/")) {
    throw new Error("Choose a photo or image (JPG, PNG, WEBP) or a PDF");
  }
  const bitmap = await createImageBitmap(file).catch(() => { throw new Error("This image format can't be opened here. Try a JPG or PNG."); });
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const g = canvas.getContext("2d")!;
  g.fillStyle = "#fff"; g.fillRect(0, 0, canvas.width, canvas.height);
  g.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("Could not process the image"))), "image/jpeg", 0.85));
  const url = await readAsDataUrl(blob);
  const name = file.name.replace(/\.[^.]+$/, "") + ".jpg";
  return { name, contentType: "image/jpeg", base64: url.split(",")[1]!, bytes: blob.size, previewUrl: url, isImage: true };
}

let worker: Promise<Worker> | null = null;
let progressCb: ((p: number) => void) | null = null;

function getWorker() {
  const base = `${window.location.origin}/ocr`;
  worker ??= createWorker(["eng", "spa"], 1, {
    workerPath: `${base}/worker.min.js`,
    corePath: `${base}/core`,
    langPath: `${base}/lang`,
    logger: (m) => { if (m.status === "recognizing text") progressCb?.(m.progress); },
  }).catch((e) => { worker = null; throw e; });
  return worker;
}

/** Returns the text on the image. Progress goes from 0 to 1 while recognising. */
export async function readText(dataUrl: string, onProgress?: (p: number) => void): Promise<string> {
  progressCb = onProgress ?? null;
  try {
    const w = await getWorker();
    const { data } = await w.recognize(dataUrl);
    return data.text;
  } finally {
    progressCb = null;
  }
}
