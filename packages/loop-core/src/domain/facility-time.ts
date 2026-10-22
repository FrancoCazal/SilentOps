/**
 * La hora del hub, no la del servidor.
 *
 * El turno es un hecho local del hub: "cierra a las 06:00" y "Handover Noche
 * 2026-09-12" se leen en la zona del hub. Con la zona del proceso esto andaba en
 * una laptop en Asuncion y fallaba en cualquier servidor en UTC (CI, Vercel): el
 * cierre quedaba corrido tres horas y el detector no disparaba nunca.
 *
 * SILENTOPS_TIMEZONE elige la zona (IANA). Por defecto, la del hub de la demo,
 * que es la misma con la que ambiguous-reader pasa el calendario a HH:MM.
 */
export const DEFAULT_FACILITY_TIME_ZONE = "America/Asuncion";

export function facilityTimeZone(): string {
  return process.env.SILENTOPS_TIMEZONE?.trim() || DEFAULT_FACILITY_TIME_ZONE;
}

export type WallClock = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

/** Fecha y hora de pared de un instante en la zona del hub. */
export function wallClock(d: Date, timeZone: string = facilityTimeZone()): WallClock {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value);
  return {
    year: part("year"),
    month: part("month"),
    day: part("day"),
    hour: part("hour"),
    minute: part("minute"),
  };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** HH:MM en la hora del hub. */
export function facilityClock(d: Date, timeZone?: string): string {
  const w = wallClock(d, timeZone);
  return `${pad(w.hour)}:${pad(w.minute)}`;
}

/** YYYY-MM-DD en la fecha del hub. */
export function facilityDateKey(d: Date, timeZone?: string): string {
  const w = wallClock(d, timeZone);
  return `${w.year}-${pad(w.month)}-${pad(w.day)}`;
}
