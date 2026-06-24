// Tiny in-memory cookie jar (PRD §7/FR5).
// Parses `set-cookie` headers, keeps the latest value per name, and
// serialises them back into a `Cookie` request header.
export class CookieJar {
  private readonly cookies = new Map<string, string>();

  setFromResponse(setCookieHeaders: string[]): void {
    for (const raw of setCookieHeaders) {
      // The cookie pair is the first segment, before any attributes.
      const pair = raw.split(";")[0]?.trim();
      if (!pair) continue;
      const eq = pair.indexOf("=");
      if (eq <= 0) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (!name) continue;
      this.cookies.set(name, value);
    }
  }

  // Seed from a raw `Cookie` request header (e.g. a value pasted from the
  // browser as a manual override, §FR5). Same `name=value; …` shape, but
  // these pairs carry no attributes.
  setFromHeader(header: string): void {
    for (const pair of header.split(";")) {
      const trimmed = pair.trim();
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const name = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim();
      if (name) this.cookies.set(name, value);
    }
  }

  header(): string {
    return [...this.cookies.entries()]
      .map(([name, value]) => `${name}=${value}`)
      .join("; ");
  }

  isEmpty(): boolean {
    return this.cookies.size === 0;
  }
}
