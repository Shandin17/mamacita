// Data model — see PRD §5

export type CustomerProfile = {
  nombre: string;
  apellidos: string;
  tipoDocumento: "NIF/NIE" | "Pasaporte";
  documento: string;
  telefono: string;
  email: string;
  observaciones?: string;
};

export type Target = {
  servicio: number;
  centro: number;
  label?: string;
};

export type Hit = {
  servicio: number;
  centro: number;
  servicioName?: string;
  centroName?: string;
  direccion?: string;
  idPeriodo?: number;
  raw: unknown;
  detectedAt: string; // ISO
  dates?: string[];
};

export type TelegramConfig = {
  botToken: string;
  chatId: string;
};

// PRD §FR4/§FR7 — jittered, time-gated polling schedule. All thresholds configurable.
export type ScheduleConfig = {
  baseSec: number; // inter-cycle base delay
  jitterSec: number; // extra uniform(0, jitterSec) added per cycle
  staggerMinSec: number; // min gap between requests within a cycle
  staggerMaxSec: number; // max gap between requests within a cycle
  activeStartHour: number; // inclusive, Europe/Madrid local hour
  activeEndHour: number; // exclusive, Europe/Madrid local hour
  activeDays: number[]; // weekdays polling is allowed (0=Sun … 6=Sat)
  timezone: string; // IANA tz the active window is expressed in
};

// PRD §FR4/§FR5 — exponential backoff applied on errors/blocks before a
// session refresh. All thresholds configurable.
export type BackoffConfig = {
  baseSec: number; // first delay after a block
  factor: number; // multiplier per consecutive block (≈2)
  capSec: number; // ceiling on the delay (~15 min)
};

// PRD §FR6/§FR7 — de-dup / state persistence + capture-on-hit settings.
export type StateConfig = {
  file?: string; // optional JSON file mirroring the in-memory state
  cooldownSec: number; // re-alert cooldown for a lingering, unchanged slot
  captureDir: string; // where the first-HIT raw payload dump is written
};

export type Config = {
  target: Target;
  telegram: TelegramConfig;
  profile: CustomerProfile;
  schedule: ScheduleConfig;
  backoff: BackoffConfig;
  // §FR5 fallback: a known-good `Cookie` header pasted from the browser.
  manualCookie?: string;
  state: StateConfig;
  minDateISO: string; // §FR1 — drop bookable dates earlier than this
};

// PRD §3.1 — a center entry returned by the centers-for-service endpoint.
export type CenterInfo = {
  id_centro: number;
  nombre?: string;
  direccion?: string;
};

// Shape of the §3.2 first-available response (only the fields we read).
export type FirstAvailableResponse = {
  dias?: unknown[];
  dias_calendario?: unknown[];
  periodos?: unknown[];
};
