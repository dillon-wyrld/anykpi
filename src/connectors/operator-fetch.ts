/**
 * Operator-controlled egress for connectors (ICS feeds, self-hosted
 * PostHog, and any other host the operator stores).
 *
 * Blocks cloud-metadata and link-local addresses so a stolen write key
 * cannot SSRF instance metadata (`169.254.169.254` and friends).
 * HTTP redirects are re-checked; a hop onto a blocked host is refused.
 *
 * Residual: RFC1918, localhost, and other operator-chosen hosts are
 * allowed. Self-hosted PostHog and internal ICS feeds are legitimate.
 * The operator is trusted to point sync at their own network. Hostnames
 * are not resolved at fetch time (a name that later answers as
 * metadata is residual); literal metadata IPs and well-known metadata
 * hosts are always refused, including after a redirect.
 */

export const BLOCKED_OPERATOR_FETCH =
  "Blocked operator fetch: cloud-metadata and link-local addresses are not allowed";

export const OPERATOR_FETCH_RESIDUAL =
  "Private RFC1918, localhost, and other operator-chosen hosts are allowed. Self-hosted analytics and internal calendar feeds are legitimate. Only cloud-metadata and link-local addresses are blocked. Hostnames are not DNS-resolved at fetch time.";

const MAX_REDIRECTS = 5;
/** Cap optional DNS so an injected resolver cannot stall a sync tick. */
const DNS_LOOKUP_TIMEOUT_MS = 400;

const METADATA_HOSTS = new Set([
  "metadata",
  "metadata.google.internal",
  "metadata.google.com",
  "instance-data",
]);

export class BlockedOperatorUrlError extends Error {
  constructor() {
    super(BLOCKED_OPERATOR_FETCH);
    this.name = "BlockedOperatorUrlError";
  }
}

export type OperatorLookup = (hostname: string) => Promise<string[]>;

function stripBrackets(hostname: string): string {
  return hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
}

function decodePackedIpv4(hostname: string): string | null {
  let n: number | null = null;
  if (/^\d+$/.test(hostname)) {
    n = Number(hostname);
  } else if (/^0x[0-9a-f]+$/i.test(hostname)) {
    n = parseInt(hostname, 16);
  }
  if (n === null || !Number.isInteger(n) || n < 0 || n > 0xffffffff) {
    return null;
  }
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".");
}

function isIpv4Literal(ip: string): boolean {
  const parts = ip.split(".");
  if (parts.length !== 4) return false;
  return parts.every((part) => /^(?:0|[1-9]\d{0,2})$/.test(part) && Number(part) <= 255);
}

function isIpv6Literal(ip: string): boolean {
  return ip.includes(":") && /^[0-9a-f:.]+$/i.test(ip);
}

function compactIpv6(ip: string): string {
  return ip
    .toLowerCase()
    .replace(/(^|:)0+/g, "$1")
    .replace(/:0+(?=:)/g, ":")
    .replace(/:{2,}/g, "::");
}

export function isLinkLocalOrMetadataAddress(address: string): boolean {
  const ip = stripBrackets(address);
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped?.[1]) return isLinkLocalOrMetadataAddress(mapped[1]);

  if (isIpv4Literal(ip)) {
    if (ip === "100.100.100.200") return true;
    const parts = ip.split(".").map(Number);
    return parts[0] === 169 && parts[1] === 254;
  }

  if (isIpv6Literal(ip)) {
    if (compactIpv6(ip) === "fd00:ec2::254") return true;
    const first = parseInt(ip.split(":")[0] ?? "", 16);
    return first >= 0xfe80 && first <= 0xfebf;
  }

  const packed = decodePackedIpv4(ip);
  return packed ? isLinkLocalOrMetadataAddress(packed) : false;
}

export function hostnameLooksLikeMetadata(hostname: string): boolean {
  const host = stripBrackets(hostname);
  if (METADATA_HOSTS.has(host)) return true;
  if (host.endsWith(".metadata.google.internal")) return true;
  if (host.endsWith(".metadata.google.com")) return true;
  return isLinkLocalOrMetadataAddress(host);
}

export function parseOperatorHttpUrl(raw: string): URL | null {
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    if (!parsed.hostname) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Sync hostname / literal-IP check. Optional DNS is test-only. */
export function operatorFetchUrlAllowed(raw: string | URL): boolean {
  const parsed = typeof raw === "string" ? parseOperatorHttpUrl(raw) : raw;
  if (!parsed) return false;
  return !hostnameLooksLikeMetadata(parsed.hostname);
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("dns-timeout")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

export async function assertOperatorFetchUrl(
  raw: string,
  resolveDns?: OperatorLookup
): Promise<URL> {
  const parsed = parseOperatorHttpUrl(raw);
  if (!parsed || hostnameLooksLikeMetadata(parsed.hostname)) {
    throw new BlockedOperatorUrlError();
  }

  const host = stripBrackets(parsed.hostname);
  if (isIpv4Literal(host) || isIpv6Literal(host) || decodePackedIpv4(host) || !resolveDns) {
    return parsed;
  }

  try {
    const addresses = await withTimeout(resolveDns(host), DNS_LOOKUP_TIMEOUT_MS);
    for (const address of addresses) {
      if (isLinkLocalOrMetadataAddress(address)) {
        throw new BlockedOperatorUrlError();
      }
    }
  } catch (error) {
    if (error instanceof BlockedOperatorUrlError) throw error;
  }

  return parsed;
}

function redirectUrl(current: URL, location: string | null): URL | null {
  if (!location) return null;
  try {
    return new URL(location, current);
  } catch {
    return null;
  }
}

export async function operatorFetch(
  input: string,
  init?: RequestInit,
  opts?: { lookup?: OperatorLookup; fetch?: typeof fetch }
): Promise<Response> {
  const doFetch = opts?.fetch ?? fetch;
  let current = await assertOperatorFetchUrl(input, opts?.lookup);

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const response = await doFetch(current.toString(), {
      ...init,
      redirect: "manual",
    });

    if (response.status < 300 || response.status >= 400) {
      return response;
    }

    const next = redirectUrl(current, response.headers.get("location"));
    if (!next) return response;
    current = await assertOperatorFetchUrl(next.toString(), opts?.lookup);
  }

  throw new BlockedOperatorUrlError();
}
