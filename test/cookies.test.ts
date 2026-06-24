import { test } from "node:test";
import assert from "node:assert/strict";
import { CookieJar } from "../src/cookies.ts";

test("stores and serialises a single cookie", () => {
  const jar = new CookieJar();
  jar.setFromResponse(["JSESSIONID=abc123; Path=/; HttpOnly"]);
  assert.equal(jar.header(), "JSESSIONID=abc123");
});

test("merges multiple set-cookie headers and overwrites by name", () => {
  const jar = new CookieJar();
  jar.setFromResponse([
    "JSESSIONID=abc123; Path=/",
    "TS01dc4fc6=zzz; Path=/; Secure",
  ]);
  jar.setFromResponse(["JSESSIONID=def456; Path=/"]);
  assert.equal(jar.header(), "JSESSIONID=def456; TS01dc4fc6=zzz");
});

test("ignores empty / malformed cookie strings", () => {
  const jar = new CookieJar();
  jar.setFromResponse(["", "  ", "no-equals-sign"]);
  assert.equal(jar.header(), "");
});

test("isEmpty reflects whether any cookie is stored", () => {
  const jar = new CookieJar();
  assert.equal(jar.isEmpty(), true);
  jar.setFromResponse(["a=1"]);
  assert.equal(jar.isEmpty(), false);
});

test("setFromHeader seeds a manual browser-pasted Cookie header", () => {
  const jar = new CookieJar();
  jar.setFromHeader("JSESSIONID=manual123; TS01dc4fc6=anti; no-eq; =bad");
  assert.equal(jar.header(), "JSESSIONID=manual123; TS01dc4fc6=anti");
});

test("a later set-cookie overrides a manually seeded cookie by name", () => {
  const jar = new CookieJar();
  jar.setFromHeader("JSESSIONID=manual123; TS01dc4fc6=anti");
  jar.setFromResponse(["JSESSIONID=fresh; Path=/"]);
  assert.equal(jar.header(), "JSESSIONID=fresh; TS01dc4fc6=anti");
});
