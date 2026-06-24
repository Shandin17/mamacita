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

  header(): string {
    return [...this.cookies.entries()]
      .map(([name, value]) => `${name}=${value}`)
      .join("; ");
  }

  isEmpty(): boolean {
    return this.cookies.size === 0;
  }
}
