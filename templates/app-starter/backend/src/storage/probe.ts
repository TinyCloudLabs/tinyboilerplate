import type { DelegatedAccess } from "@tinyboilerplate/server";
import { PROBE_KV_PREFIX } from "../manifest.js";

export interface ProbeValue {
  value: string;
  updatedAt: string;
}

export class InputError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const PROBE_KEY = `${PROBE_KV_PREFIX}value`;
const MAX_PROBE_VALUE_LENGTH = 1024;

export async function getProbe(access: DelegatedAccess): Promise<ProbeValue | null> {
  const result = await access.kv.get(PROBE_KEY);
  if (!result.ok) {
    if (/not found/i.test(result.error.message)) return null;
    throw new Error(`Failed to read probe value: ${result.error.message}`);
  }

  return decodeProbe(result.data.data);
}

export async function putProbe(access: DelegatedAccess, input: unknown): Promise<ProbeValue> {
  const value = normalizeProbeValue(input);
  const probe: ProbeValue = {
    value,
    updatedAt: new Date().toISOString(),
  };
  const result = await access.kv.put(PROBE_KEY, JSON.stringify(probe));
  if (!result.ok) throw new Error(`Failed to write probe value: ${result.error.message}`);
  return probe;
}

export async function deleteProbe(access: DelegatedAccess): Promise<void> {
  const result = await access.kv.delete(PROBE_KEY);
  if (!result.ok && !isSuccessfulDeleteParseError(result.error.message)) {
    throw new Error(`Failed to delete probe value: ${result.error.message}`);
  }
}

export function probeKey(): string {
  return PROBE_KEY;
}

function normalizeProbeValue(input: unknown): string {
  if (typeof input !== "object" || input === null) {
    throw new InputError("invalid_body", "Request body must be an object.");
  }
  const value = (input as { value?: unknown }).value;
  if (typeof value !== "string") {
    throw new InputError("invalid_body", "Probe value must be a string.");
  }
  if (value.length > MAX_PROBE_VALUE_LENGTH) {
    throw new InputError(
      "value_too_long",
      `Probe value must be at most ${MAX_PROBE_VALUE_LENGTH} characters.`,
    );
  }
  return value;
}

function decodeProbe(value: unknown): ProbeValue | null {
  const parsed = typeof value === "string" ? parseProbeJson(value) : value;
  if (typeof parsed !== "object" || parsed === null) return null;
  const candidate = parsed as Partial<ProbeValue>;
  if (typeof candidate.value === "string" && typeof candidate.updatedAt === "string") {
    return { value: candidate.value, updatedAt: candidate.updatedAt };
  }
  return null;
}

function parseProbeJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function isSuccessfulDeleteParseError(message: string): boolean {
  return /error parsing xml:\s*no root element/i.test(message);
}
