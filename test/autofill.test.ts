import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FIELD_LABELS,
  buildAutofillConfig,
  buildAutofillSnippet,
  buildBookmarklet,
  fillValenciaForm,
  AUTOFILL_RUNTIME_SOURCE,
} from "../src/autofill.ts";
import type { CustomerProfile } from "../src/types.ts";

const profile: CustomerProfile = {
  nombre: "Valerii",
  apellidos: "Shandin",
  tipoDocumento: "NIF/NIE",
  documento: "Z4610343K",
  telefono: "600000000",
  email: "valerii@example.com",
  observaciones: "Alta en el padrón",
};

// ---------- minimal Angular-Material-like DOM mock ----------

type ElOpts = {
  attrs?: Record<string, string>;
  text?: string;
  value?: string;
  classes?: string[];
  options?: { textContent: string; value: string }[];
};

class El {
  tagName: string;
  attrs: Record<string, string>;
  textContent: string;
  value: string;
  classList: Set<string>;
  options?: { textContent: string; value: string }[];
  selectedIndex = -1;
  children: El[] = [];
  parent: El | null = null;
  events: string[] = [];

  constructor(tag: string, opts: ElOpts = {}) {
    this.tagName = tag.toUpperCase();
    this.attrs = opts.attrs ?? {};
    this.textContent = opts.text ?? "";
    this.value = opts.value ?? "";
    this.classList = new Set(opts.classes ?? []);
    this.options = opts.options;
  }
  append(...kids: El[]): El {
    for (const k of kids) {
      k.parent = this;
      this.children.push(k);
    }
    return this;
  }
  getAttribute(n: string): string | null {
    return n in this.attrs ? this.attrs[n] : null;
  }
  dispatchEvent(ev: { type: string }): boolean {
    this.events.push(ev.type);
    return true;
  }
  private matchesSel(part: string): boolean {
    part = part.trim();
    if (part.startsWith(".")) return this.classList.has(part.slice(1));
    return this.tagName === part.toUpperCase();
  }
  private descendants(): El[] {
    const out: El[] = [];
    for (const c of this.children) out.push(c, ...c.descendants());
    return out;
  }
  querySelectorAll(sel: string): El[] {
    const parts = sel.split(",");
    return this.descendants().filter((d) =>
      parts.some((p) => d.matchesSel(p)),
    );
  }
  querySelector(sel: string): El | null {
    return this.querySelectorAll(sel)[0] ?? null;
  }
  closest(sel: string): El | null {
    const parts = sel.split(",");
    let n: El | null = this;
    while (n) {
      if (parts.some((p) => n!.matchesSel(p))) return n;
      n = n.parent;
    }
    return null;
  }
}

function matField(labelText: string, control: El): El {
  return new El("mat-form-field").append(
    new El("mat-label", { text: labelText }),
    control,
  );
}

function buildForm() {
  const documentSelect = new El("select", {
    options: [
      { textContent: "NIF/NIE", value: "NIF/NIE" },
      { textContent: "Pasaporte", value: "Pasaporte" },
    ],
  });
  const captcha = new El("input", {
    attrs: { id: "captcha", placeholder: "Codi de seguretat" },
  });
  const acceptar = new El("button", { text: "Acceptar" });

  const fields = {
    nombre: new El("input"),
    apellidos: new El("input"),
    tipoDocumento: documentSelect,
    documento: new El("input"),
    telefono: new El("input"),
    email: new El("input"),
    observaciones: new El("textarea"),
  };

  const form = new El("form").append(
    matField("Nom", fields.nombre),
    matField("Cognoms", fields.apellidos),
    matField("Tipus de document", fields.tipoDocumento),
    matField("Document", fields.documento),
    matField("Telèfon", fields.telefono),
    matField("Email", fields.email),
    matField("Observacions", fields.observaciones),
    captcha,
    acceptar,
  );
  const root = new El("body").append(form);
  const doc = {
    querySelectorAll: (sel: string) => root.querySelectorAll(sel),
    getElementById: (id: string) =>
      root.querySelectorAll("input,select,textarea,button").find(
        (e) => e.getAttribute("id") === id,
      ) ?? null,
  };
  return { doc, fields, captcha, acceptar };
}

// ---------- generation ----------

test("FIELD_LABELS covers all seven form fields", () => {
  const keys = Object.keys(FIELD_LABELS);
  for (const k of [
    "nombre",
    "apellidos",
    "tipoDocumento",
    "documento",
    "telefono",
    "email",
    "observaciones",
  ]) {
    assert.ok(keys.includes(k), `missing labels for ${k}`);
  }
});

test("buildAutofillSnippet embeds profile values and field labels", () => {
  const snippet = buildAutofillSnippet(profile);
  assert.match(snippet, /Valerii/);
  assert.match(snippet, /Z4610343K/);
  assert.match(snippet, /valerii@example\.com/);
  assert.match(snippet, /Nom/);
  assert.match(snippet, /Cognoms/);
  assert.match(snippet, /Observacions/);
  assert.match(snippet, /fillValenciaForm/);
});

test("buildBookmarklet produces a single-line javascript: URL", () => {
  const bm = buildBookmarklet(profile);
  assert.ok(bm.startsWith("javascript:"), "must start with javascript:");
  assert.ok(!bm.includes("\n"), "must be a single line");
  const decoded = decodeURIComponent(bm.slice("javascript:".length));
  assert.match(decoded, /fillValenciaForm/);
  assert.match(decoded, /Z4610343K/);
});

test("runtime never interacts with the captcha or the Acceptar button", () => {
  assert.ok(!/captcha/i.test(AUTOFILL_RUNTIME_SOURCE));
  assert.ok(!/acceptar/i.test(AUTOFILL_RUNTIME_SOURCE));
  assert.ok(!/\.submit\s*\(/i.test(AUTOFILL_RUNTIME_SOURCE));
  assert.ok(!/\.click\s*\(/i.test(AUTOFILL_RUNTIME_SOURCE));
});

// ---------- behavior ----------

test("fillValenciaForm fills all seven fields with input/change events", () => {
  const { doc, fields } = buildForm();
  const cfg = buildAutofillConfig(profile);
  const result = fillValenciaForm(cfg, doc);

  assert.deepEqual(result.missing, []);
  assert.equal(fields.nombre.value, "Valerii");
  assert.equal(fields.apellidos.value, "Shandin");
  assert.equal(fields.documento.value, "Z4610343K");
  assert.equal(fields.telefono.value, "600000000");
  assert.equal(fields.email.value, "valerii@example.com");
  assert.equal(fields.observaciones.value, "Alta en el padrón");

  for (const el of [
    fields.nombre,
    fields.documento,
    fields.email,
    fields.observaciones,
  ]) {
    assert.ok(el.events.includes("input"), "input dispatched");
    assert.ok(el.events.includes("change"), "change dispatched");
  }
});

test("fillValenciaForm selects the correct document-type option", () => {
  const { doc, fields } = buildForm();
  fillValenciaForm(buildAutofillConfig(profile), doc);
  assert.equal(fields.tipoDocumento.selectedIndex, 0);
  assert.equal(fields.tipoDocumento.value, "NIF/NIE");
  assert.ok(fields.tipoDocumento.events.includes("change"));
});

test("fillValenciaForm leaves the captcha and Acceptar button untouched", () => {
  const { doc, captcha, acceptar } = buildForm();
  fillValenciaForm(buildAutofillConfig(profile), doc);
  assert.equal(captcha.value, "");
  assert.deepEqual(captcha.events, []);
  assert.deepEqual(acceptar.events, []);
});

test("fillValenciaForm skips an absent optional field without error", () => {
  const { doc, fields } = buildForm();
  const { observaciones, ...rest } = profile;
  void observaciones;
  const result = fillValenciaForm(buildAutofillConfig(rest as CustomerProfile), doc);
  assert.ok(result.filled.includes("nombre"));
  assert.equal(fields.observaciones.value, "");
});
