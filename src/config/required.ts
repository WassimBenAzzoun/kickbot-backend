export function requireEnvValue(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(`${name} is required for this runtime but was not provided.`);
  }

  return value;
}