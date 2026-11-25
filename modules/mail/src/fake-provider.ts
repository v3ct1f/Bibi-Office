import { MailProviderError, type IncomingMail, type MailProvider, type OutgoingMail, type Party, type ProviderAccount } from "./provider.ts";

/**
 * A pretend mail server for local use and tests: no network, no accounts, nothing real.
 * Every address has an in-memory mailbox. The first time one is read it gets a few sample messages (unless `seed: false`).
 * Sending delivers to the recipients' pretend mailboxes, so colleagues in the same local business can mail each other.
 */
export interface FakeMailProvider extends MailProvider {
  /** Puts a message into an address's mailbox (what the next fetch returns). */
  deliver(address: string, mail: Partial<IncomingMail> & { from: Party; subject: string }): IncomingMail;
  /** Everything sent through it, oldest first. */
  readonly sent: OutgoingMail[];
  /** Makes the next call of that kind ("send" or "fetch") fail once. */
  failNext(call: "send" | "fetch"): void;
  fetches: number;
  reset(): void;
}

const norm = (a: string) => a.trim().toLowerCase();

export function fakeMailProvider(opts: { seed?: boolean } = {}): FakeMailProvider {
  const seed = opts.seed ?? true;
  const boxes = new Map<string, IncomingMail[]>();
  const seeded = new Set<string>();
  const sent: OutgoingMail[] = [];
  let counter = 0;
  let fail: "send" | "fetch" | null = null;

  const box = (address: string) => { const k = norm(address); if (!boxes.has(k)) boxes.set(k, []); return boxes.get(k)!; };
  const deliver: FakeMailProvider["deliver"] = (address, m) => {
    const uid = String(++counter);
    const full: IncomingMail = {
      uid, messageId: `<fake-${uid}@mail.test>`, inReplyTo: null, references: [], to: [{ name: "", email: norm(address) }], cc: [],
      text: "", html: null, date: new Date().toISOString(), files: [], ...m,
    };
    box(address).push(full);
    return full;
  };

  function sample(address: string) {
    const ago = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
    const me = { name: "", email: address };
    deliver(address, {
      from: { name: "The Office team", email: "hello@office.test" }, to: [me], subject: "Welcome to your new mailbox", date: ago(30),
      text: "Hi!\n\nThis is your own private inbox inside Office. Only you can read it.\n\nTry the keyboard: c writes a new message, j and k move up and down, e archives, # deletes and / searches.\n\nEnjoy!",
      html: "<p>Hi!</p><p>This is your own <b>private inbox</b> inside Office. Only you can read it.</p><p>Try the keyboard: <b>c</b> writes a new message, <b>j</b> and <b>k</b> move up and down, <b>e</b> archives, <b>#</b> deletes and <b>/</b> searches.</p><p>Enjoy!</p>",
    });
    const first = deliver(address, {
      from: { name: "Carla Mendes", email: "carla@clientco.test" }, to: [me], subject: "Quote for the spring order", date: ago(26),
      text: "Hello,\n\nCould you send me a quote for 40 units of the large model? We would like delivery before the 15th.\n\nThanks,\nCarla",
    });
    deliver(address, {
      from: { name: "Carla Mendes", email: "carla@clientco.test" }, to: [me], subject: "Re: Quote for the spring order", date: ago(3),
      inReplyTo: first.messageId, references: [first.messageId!],
      text: "Hi again,\n\nJust checking whether you had a chance to look at the quote. The specification is attached.\n\nCarla",
      files: [{ name: "specification.txt", contentType: "text/plain", data: Buffer.from("Model L, 40 units, delivery before the 15th.\n") }],
    });
    deliver(address, {
      from: { name: "Shop Deals", email: "news@deals.test" }, to: [me], subject: "Big sale: 50% off everything!", date: ago(8),
      text: "Big sale this weekend only. See the pictures online.",
      html: "<h2 style=\"color:#c00\">Big sale!</h2><p>50% off everything this weekend.</p><img src=\"https://tracker.test/pixel.gif\" width=\"1\" height=\"1\"><p><a href=\"https://deals.test/sale\" onclick=\"alert(1)\">Shop now</a></p><script>alert('xss')</script>",
    });
    deliver(address, {
      from: { name: "Prize Winner", email: "winner@lotto-prize.test" }, to: [me], subject: "You have won a million!!!", date: ago(12), spam: true,
      text: "Send us your bank details to claim your prize.",
    });
  }

  return {
    key: "fake",
    autoProvision: true,
    sent,
    fetches: 0,
    deliver,
    failNext(call) { fail = call; },
    reset() { boxes.clear(); seeded.clear(); sent.length = 0; counter = 0; fail = null; this.fetches = 0; },
    async fetchNew(account: ProviderAccount, cursor) {
      this.fetches++;
      if (fail === "fetch") { fail = null; throw new MailProviderError("The mail server isn't answering."); }
      const address = norm(account.address);
      if (seed && !seeded.has(address)) { seeded.add(address); sample(address); }
      const after = Number(cursor ?? 0);
      const all = box(address);
      const messages = all.filter((m) => Number(m.uid) > after);
      const last = all.length ? Math.max(...all.map((m) => Number(m.uid))) : after;
      return { messages, cursor: String(Math.max(last, after)) };
    },
    async send(account, mail) {
      if (fail === "send") { fail = null; throw new MailProviderError("The mail server refused the message."); }
      sent.push(mail);
      const seen = new Set<string>();
      for (const p of [...mail.to, ...mail.cc, ...mail.bcc]) {
        const to = norm(p.email);
        if (seen.has(to) || to === norm(account.address)) continue; // a copy for yourself is the Sent folder
        seen.add(to);
        deliver(to, {
          from: mail.from, to: mail.to, cc: mail.cc, subject: mail.subject, text: mail.text, html: mail.html, messageId: mail.messageId,
          inReplyTo: mail.inReplyTo, references: mail.references, files: mail.files,
        });
      }
    },
  };
}
