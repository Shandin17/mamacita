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

export type Config = {
  target: Target;
  telegram: TelegramConfig;
  profile: CustomerProfile;
};

// Shape of the §3.2 first-available response (only the fields we read).
export type FirstAvailableResponse = {
  dias?: unknown[];
  dias_calendario?: unknown[];
  periodos?: unknown[];
};
