import { useEffect, useMemo, useRef, useState } from "react";
import { ImagePlus, Search } from "lucide-react";
import { Button, Input, Spinner, cn } from "@office/ui";
import { useModuleHost } from "@office/ui/module-ui";
import { errorMessage } from "./shared.tsx";

// A compact, hand-picked set: enough for everyday chat without a heavy library.
const EMOJI: { label: string; icon: string; list: string }[] = [
  { label: "Smileys", icon: "😀", list: "😀 😃 😄 😁 😆 😅 🤣 😂 🙂 🙃 😉 😊 😇 🥰 😍 🤩 😘 😗 😚 😋 😛 😜 🤪 😝 🤑 🤗 🤭 🤫 🤔 🤐 🤨 😐 😑 😶 😏 😒 🙄 😬 😌 😔 😪 🤤 😴 😷 🤒 🤕 🤢 🤮 🥵 🥶 🥴 😵 🤯 🤠 🥳 😎 🤓 🧐 😕 😟 🙁 😮 😯 😲 😳 🥺 😦 😧 😨 😰 😥 😢 😭 😱 😖 😣 😞 😓 😩 😫 🥱 😤 😡 😠 🤬 😈 💀 💩 🤡 👻 👽 🤖" },
  { label: "Gestures", icon: "👍", list: "👋 🤚 🖐️ ✋ 🖖 👌 🤌 🤏 ✌️ 🤞 🤟 🤘 🤙 👈 👉 👆 👇 ☝️ 👍 👎 ✊ 👊 🤛 🤜 👏 🙌 👐 🤲 🤝 🙏 ✍️ 💪 🫶 👀 🧠 🫡 🤷 🤦 🙋 🙆 🙅 💁 🙇" },
  { label: "Hearts", icon: "❤️", list: "❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 💯 💢 💥 💫 💦 💨 🕳️ 💬 💭 💤" },
  { label: "Work", icon: "💼", list: "💼 📁 📂 🗂️ 📅 📆 🗓️ 📇 📈 📉 📊 📋 📌 📍 📎 🖇️ 📏 📐 ✂️ 🗃️ 🗄️ 🗑️ 🔒 🔓 🔑 🗝️ 🔨 🛠️ 🔧 ⚙️ 🧰 💻 🖥️ 🖨️ ⌨️ 🖱️ 📱 ☎️ 📞 📠 📧 ✉️ 📨 📩 📤 📥 📦 🏷️ 💰 💶 💵 💳 🧾 ✅ ☑️ ❌ ❗ ❓ ⚠️ 🚫 ⏰ ⏳ ⌛ 🕐" },
  { label: "Food", icon: "🍕", list: "☕ 🍵 🧃 🥤 🍺 🍻 🥂 🍷 🍸 🍹 🍾 🍕 🍔 🍟 🌭 🥪 🌮 🌯 🥗 🍝 🍜 🍣 🍱 🥟 🍤 🍙 🍚 🍛 🥐 🥖 🥨 🧀 🥚 🍳 🥞 🧇 🥓 🍰 🎂 🧁 🥧 🍫 🍬 🍭 🍩 🍪 🍎 🍌 🍉 🍇 🍓 🍒 🍑 🥭 🍍 🥥 🥑 🍅 🥕 🌽" },
  { label: "Things", icon: "🎉", list: "🎉 🎊 🎈 🎁 🎀 🏆 🥇 🥈 🥉 🏅 🎖️ ⚽ 🏀 🏈 ⚾ 🎾 🏐 🎱 🏓 🎯 🎮 🎲 🧩 🎨 🎬 🎤 🎧 🎵 🎶 🎸 🚗 🚕 🚌 🚚 🚲 ✈️ 🚀 🏠 🏢 🏬 🏥 🏦 🏨 🏖️ ⛰️ 🌍 ☀️ 🌤️ ⛅ 🌧️ ⛈️ ❄️ 🌈 🔥 ⭐ 🌟 ✨ ⚡ 🌙 🌸 🌻 🌹 🌷 🌱 🌳 🍀 🐶 🐱 🐻 🐼 🦊 🐸 🐵 🦄 🐝 🦋" },
];
const RECENT_KEY = "office.messages.recentEmoji";
const recent = (): string[] => { try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as string[]; } catch { return []; } };
const remember = (e: string) => { try { localStorage.setItem(RECENT_KEY, JSON.stringify([e, ...recent().filter((x) => x !== e)].slice(0, 24))); } catch { /* private mode */ } };

/** Built-in stickers: big, friendly emoji for quick reactions. */
export const STICKERS = "👍 👏 🙌 🎉 🥳 😂 🤣 😍 🥰 😎 🤩 😮 😢 😭 😡 🤯 🙏 💪 🔥 💯 ❤️ ✅ 👀 🤝 ☕ 🍕 🚀 🏆 ⭐ 🌈 😴 🤔".split(" ");

export interface Gif { id: string; title: string; url: string; preview: string; width: number; height: number }

function EmojiTab({ onPick }: { onPick: (e: string) => void }) {
  const [cat, setCat] = useState(-1);
  const rec = useMemo(recent, []);
  const sets = rec.length ? [{ label: "Recent", icon: "🕘", list: rec.join(" ") }, ...EMOJI] : EMOJI;
  const shown = cat < 0 ? sets : [sets[cat]!];
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex gap-0.5 border-b px-1 pb-1" role="tablist" aria-label="Emoji groups">
        {sets.map((c, i) => (
          <button key={c.label} type="button" role="tab" aria-selected={cat === i} title={c.label} onClick={() => setCat(cat === i ? -1 : i)}
            className={cn("cursor-pointer rounded px-1.5 py-1 text-lg hover:bg-accent", cat === i && "bg-accent")}>{c.icon}</button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-1">
        {shown.map((c) => (
          <section key={c.label} aria-label={c.label}>
            <p className="px-1 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{c.label}</p>
            <div className="grid grid-cols-8 gap-0.5">
              {c.list.split(" ").filter(Boolean).map((e, i) => (
                <button key={`${e}${i}`} type="button" aria-label={e} onClick={() => { remember(e); onPick(e); }}
                  className="grid aspect-square cursor-pointer place-items-center rounded text-xl hover:bg-accent">{e}</button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function GifTab({ onPick, onUpload }: { onPick: (g: Gif) => void; onUpload: () => void }) {
  const host = useModuleHost();
  const [q, setQ] = useState("");
  const [state, setState] = useState<{ enabled: boolean; data: Gif[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  useEffect(() => {
    const n = ++seq.current;
    const t = setTimeout(() => {
      setError(null);
      host.api.get<{ enabled: boolean; data: Gif[] }>("/gifs", q.trim() ? { q: q.trim() } : {})
        .then((r) => { if (n === seq.current) setState(r); })
        .catch((e) => { if (n === seq.current) setError(errorMessage(e)); });
    }, q ? 350 : 0);
    return () => clearTimeout(t);
  }, [q, host]);

  if (state && !state.enabled) {
    return (
      <div className="grid flex-1 place-content-center gap-3 p-4 text-center text-sm text-muted-foreground">
        <p>GIF search is off. The business owner can turn it on by adding a free GIPHY key in <b>Add features → Messages → Settings</b>.</p>
        <Button variant="outline" size="sm" className="justify-self-center" onClick={onUpload}><ImagePlus /> Send a GIF file</Button>
      </div>
    );
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 p-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
        <Input aria-label="Search GIFs" className="pl-8" placeholder="Search GIPHY" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {error ? <p className="p-3 text-center text-sm text-destructive">{error}</p>
          : !state ? <div className="grid h-32 place-items-center"><Spinner /></div>
          : !state.data.length ? <p className="p-3 text-center text-sm text-muted-foreground">No GIFs found.</p>
          : (
            <div className="columns-2 gap-1.5 sm:columns-3">
              {state.data.map((g) => (
                <button key={g.id} type="button" onClick={() => onPick(g)} aria-label={`Send GIF ${g.title}`}
                  className="mb-1.5 block w-full cursor-pointer overflow-hidden rounded-md bg-muted hover:opacity-80">
                  <img src={g.preview} alt={g.title} loading="lazy" className="w-full" />
                </button>
              ))}
            </div>
          )}
      </div>
      <p className="text-right text-[10px] text-muted-foreground">Powered by GIPHY</p>
    </div>
  );
}

function StickerTab({ onPick, onNew }: { onPick: (emoji: string) => void; onNew: () => void }) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-2">
      <div className="grid grid-cols-4 gap-1">
        <button type="button" onClick={onNew} className="grid aspect-square cursor-pointer place-items-center rounded-lg border border-dashed text-muted-foreground hover:bg-accent" aria-label="New sticker from a picture">
          <span className="grid justify-items-center gap-1 text-[11px]"><ImagePlus className="size-5" />New</span>
        </button>
        {STICKERS.map((s) => (
          <button key={s} type="button" onClick={() => onPick(s)} aria-label={`Send sticker ${s}`}
            className="grid aspect-square cursor-pointer place-items-center rounded-lg text-5xl transition-transform hover:scale-110 hover:bg-accent">{s}</button>
        ))}
      </div>
    </div>
  );
}

/** The smiley button's panel: Emoji (into the text), GIFs and Stickers (sent right away). */
export function ExpressionPanel({ onEmoji, onGif, onSticker, onNewSticker, onGifFile, onClose }: {
  onEmoji: (e: string) => void; onGif: (g: Gif) => void; onSticker: (emoji: string) => void; onNewSticker: () => void; onGifFile: () => void; onClose: () => void;
}) {
  const [tab, setTab] = useState<"emoji" | "gif" | "sticker">("emoji");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const away = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node) && !(e.target as Element).closest?.("[data-expression-toggle]")) onClose(); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [onClose]);
  return (
    <div ref={ref} role="dialog" aria-label="Emoji, GIFs and stickers"
      className="absolute bottom-full left-2 z-30 mb-2 flex h-80 w-[min(22rem,calc(100vw-2.5rem))] flex-col overflow-hidden rounded-xl border bg-surface shadow-lg">
      {tab === "emoji" ? <EmojiTab onPick={onEmoji} />
        : tab === "gif" ? <GifTab onPick={(g) => { onGif(g); onClose(); }} onUpload={() => { onGifFile(); onClose(); }} />
        : <StickerTab onPick={(s) => { onSticker(s); onClose(); }} onNew={() => { onNewSticker(); onClose(); }} />}
      <div className="flex border-t" role="tablist" aria-label="Emoji, GIFs or stickers">
        {([["emoji", "Emoji"], ["gif", "GIFs"], ["sticker", "Stickers"]] as const).map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={cn("flex-1 cursor-pointer py-2 text-xs font-medium", tab === k ? "border-t-2 border-primary text-primary" : "text-muted-foreground hover:text-foreground")}>{l}</button>
        ))}
      </div>
    </div>
  );
}
