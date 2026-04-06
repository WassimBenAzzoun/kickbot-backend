import { z } from "zod";

export const kickUsernameSchema = z
  .string()
  .trim()
  .min(3, "Username must be at least 3 characters")
  .max(30, "Username must be at most 30 characters")
  .regex(/^[a-zA-Z0-9_]+$/, "Only letters, numbers, and underscores are allowed")
  .transform((value) => value.toLowerCase());

export function parseKickUsername(value: string): string {
  return kickUsernameSchema.parse(value);
}