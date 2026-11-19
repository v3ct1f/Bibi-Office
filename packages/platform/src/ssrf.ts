import { lookup } from "node:dns";
import ipaddr from "ipaddr.js";
import { Agent } from "undici";

/** True for loopback, private, link-local (incl. cloud metadata 169.254.169.254), multicast, reserved, etc. */
export function isBlockedIp(ip: string): boolean {
  try {
    let a = ipaddr.parse(ip);
    if (a.kind() === "ipv6" && (a as ipaddr.IPv6).isIPv4MappedAddress()) a = (a as ipaddr.IPv6).toIPv4Address();
    return a.range() !== "unicast";
  } catch {
    return true;
  }
}

/**
 * HTTP agent that validates the resolved IP at connect time (defeats DNS rebinding,
 * unlike a pre-check followed by a fresh lookup). allowPrivate is for dev/test only.
 */
export function guardedAgent(opts: { allowPrivate?: boolean } = {}) {
  return new Agent({
    connect: {
      timeout: 5_000,
      lookup(hostname, options, cb) {
        lookup(hostname, { ...options, all: true }, (err, addrs) => {
          if (err) return cb(err, "", 4);
          const list = (addrs as unknown as { address: string; family: number }[]);
          const bad = !opts.allowPrivate && list.find((a) => isBlockedIp(a.address));
          if (bad || !list.length) return cb(new Error(`Blocked destination address for ${hostname}`), "", 4);
          if ((options as { all?: boolean }).all) return (cb as unknown as (e: null, a: typeof list) => void)(null, list);
          cb(null, list[0]!.address, list[0]!.family);
        });
      },
    },
    headersTimeout: 10_000,
    bodyTimeout: 10_000,
    maxRedirections: 0,
  } as ConstructorParameters<typeof Agent>[0]);
}

export function assertUrlAllowed(raw: string, o: { requireHttps: boolean; allowPrivate?: boolean }): URL {
  let u: URL;
  try { u = new URL(raw); } catch { throw new Error("Invalid URL"); }
  if (u.protocol !== "https:" && (o.requireHttps || u.protocol !== "http:")) throw new Error("URL must use https");
  if (u.username || u.password) throw new Error("URL must not contain credentials");
  if (!o.allowPrivate && /^\d+\.\d+\.\d+\.\d+$|^\[/.test(u.hostname) && isBlockedIp(u.hostname.replace(/^\[|\]$/g, ""))) {
    throw new Error("Blocked destination address");
  }
  return u;
}
