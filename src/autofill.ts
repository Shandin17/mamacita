import type { CustomerProfile } from "./types.ts";

// PRD §3/FR3 (issue #5): one-time autofill helper for the Valencia padrón
// booking form. Generated from the CustomerProfile (§5), it fills the seven
// form fields and dispatches input/change events so the Angular reactive form
// registers the values. It deliberately NEVER touches the verification image
// and NEVER clicks the final confirmation button — those stay 100% manual
// (PRD §9). Captcha + submit are out of scope by design.

export type AutofillConfig = {
  profile: CustomerProfile;
  labels: Record<string, string[]>;
};

// The label text the municipal Angular form renders for each profile field
// (Valencian, `idioma=VA`). Several candidates per field cover diacritic and
// wording variants; matching is accent-insensitive and prefix-based.
export const FIELD_LABELS: Record<keyof CustomerProfile, string[]> = {
  nombre: ["Nom"],
  apellidos: ["Cognoms"],
  tipoDocumento: ["Tipus de document", "Tipus document"],
  documento: ["Document", "Número de document", "Numero de document"],
  telefono: ["Telèfon", "Telefon"],
  email: ["Email", "Correu electrònic", "Correu electronic", "Correu"],
  observaciones: ["Observacions"],
};

export function buildAutofillConfig(profile: CustomerProfile): AutofillConfig {
  return { profile, labels: FIELD_LABELS };
}

// Browser-side source, kept as a plain-JS string so it is the single source of
// truth: tested below via `new Function`, and embedded verbatim in both the
// readable snippet and the bookmarklet. No DOM types are available in this
// project (lib: ES2022), and the bookmarklet must be self-contained anyway.
export const AUTOFILL_RUNTIME_SOURCE = `function fillValenciaForm(cfg, doc) {
  doc = doc || (typeof document !== "undefined" ? document : null);
  if (!doc) return { filled: [], missing: [] };
  var profile = cfg.profile;
  var labels = cfg.labels;

  var norm = function (s) {
    return String(s == null ? "" : s)
      .normalize("NFD")
      .replace(/[\\u0300-\\u036f]/g, "")
      .replace(/[*:]/g, "")
      .replace(/\\s+/g, " ")
      .trim()
      .toLowerCase();
  };
  var matches = function (text, cands) {
    var t = norm(text);
    if (!t) return false;
    for (var i = 0; i < cands.length; i++) {
      var c = norm(cands[i]);
      if (c && (t === c || t.indexOf(c) === 0)) return true;
    }
    return false;
  };
  var fire = function (el) {
    var make = function (type) {
      try {
        return new Event(type, { bubbles: true });
      } catch (e) {
        var ev = doc.createEvent("Event");
        ev.initEvent(type, true, true);
        return ev;
      }
    };
    el.dispatchEvent(make("input"));
    el.dispatchEvent(make("change"));
    el.dispatchEvent(make("blur"));
  };
  var isControl = function (el) {
    var tag = (el.tagName || "").toUpperCase();
    return tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA";
  };
  var setText = function (el, value) {
    el.value = value;
    fire(el);
  };
  var setSelect = function (el, value) {
    var want = norm(value);
    var opts = el.options || [];
    for (var i = 0; i < opts.length; i++) {
      var ot = norm(opts[i].textContent || opts[i].label || opts[i].value);
      var ov = norm(opts[i].value);
      if (ot === want || ov === want || ot.indexOf(want) === 0) {
        el.selectedIndex = i;
        el.value = opts[i].value;
        fire(el);
        return;
      }
    }
    el.value = value;
    fire(el);
  };

  var findByLabelFor = function (cands) {
    var lbls = doc.querySelectorAll("label");
    for (var i = 0; i < lbls.length; i++) {
      if (!matches(lbls[i].textContent, cands)) continue;
      var forId = lbls[i].getAttribute("for");
      if (forId) {
        var el = doc.getElementById(forId);
        if (el) return el;
      }
      if (lbls[i].querySelector) {
        var inside = lbls[i].querySelector("input,select,textarea");
        if (inside) return inside;
      }
    }
    return null;
  };
  var findByFormField = function (cands) {
    var lbls = doc.querySelectorAll(
      "label,mat-label,.mat-form-field-label",
    );
    for (var i = 0; i < lbls.length; i++) {
      if (!matches(lbls[i].textContent, cands)) continue;
      var field = lbls[i].closest
        ? lbls[i].closest("mat-form-field,.mat-form-field,.form-group")
        : null;
      if (field && field.querySelector) {
        var el = field.querySelector("input,select,textarea");
        if (el) return el;
      }
    }
    return null;
  };
  var findByAttr = function (cands) {
    var nodes = doc.querySelectorAll("input,select,textarea");
    var attrs = ["formcontrolname", "name", "aria-label", "placeholder", "id"];
    for (var i = 0; i < nodes.length; i++) {
      for (var a = 0; a < attrs.length; a++) {
        var v = nodes[i].getAttribute(attrs[a]);
        if (v && matches(v, cands)) return nodes[i];
      }
    }
    return null;
  };
  var find = function (cands) {
    return (
      findByLabelFor(cands) || findByFormField(cands) || findByAttr(cands)
    );
  };

  var keys = [
    "nombre",
    "apellidos",
    "tipoDocumento",
    "documento",
    "telefono",
    "email",
    "observaciones",
  ];
  var filled = [];
  var missing = [];
  for (var k = 0; k < keys.length; k++) {
    var key = keys[k];
    var value = profile[key];
    if (value == null || value === "") continue;
    var cands = labels[key] || [];
    var target = find(cands);
    if (!target || !isControl(target)) {
      missing.push(key);
      continue;
    }
    if ((target.tagName || "").toUpperCase() === "SELECT")
      setSelect(target, value);
    else setText(target, value);
    filled.push(key);
  }

  // Stops here on purpose: the verification image and the final confirmation
  // button are never read or pressed — the human completes those manually.
  return { filled: filled, missing: missing };
}`;

// Node-side handle on the exact browser source, for tests and any future
// server-side use. The browser receives the string above verbatim.
export const fillValenciaForm = new Function(
  `${AUTOFILL_RUNTIME_SOURCE}\nreturn fillValenciaForm;`,
)() as (
  cfg: AutofillConfig,
  doc?: unknown,
) => { filled: string[]; missing: string[] };

// A readable, paste-anywhere `.js` snippet generated from the profile.
export function buildAutofillSnippet(profile: CustomerProfile): string {
  const cfg = buildAutofillConfig(profile);
  return [
    "// Valencia padrón — autofill helper (generated from your CustomerProfile).",
    "// Run it AFTER the booking form has loaded. It fills the seven fields and",
    "// fires input/change events so Angular registers them. It does NOT solve",
    "// the verification image and does NOT press the confirm button — do those",
    "// by hand. See README for install instructions.",
    "",
    `var AUTOFILL_CONFIG = ${JSON.stringify(cfg, null, 2)};`,
    "",
    AUTOFILL_RUNTIME_SOURCE,
    "",
    "fillValenciaForm(AUTOFILL_CONFIG);",
    "",
  ].join("\n");
}

// A one-line `javascript:` bookmarklet generated from the profile.
export function buildBookmarklet(profile: CustomerProfile): string {
  const cfg = buildAutofillConfig(profile);
  const iife =
    "(function(){" +
    `var __cfg=${JSON.stringify(cfg)};` +
    AUTOFILL_RUNTIME_SOURCE +
    "fillValenciaForm(__cfg);})();";
  return "javascript:" + encodeURIComponent(iife);
}
