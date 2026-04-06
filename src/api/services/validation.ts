import { z } from "zod";
import { ApiError } from "./errors";

export function parseWithZod<TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  payload: unknown,
  errorMessage: string
): z.infer<TSchema> {
  const parsed = schema.safeParse(payload);

  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => issue.message).join("; ");
    throw new ApiError(400, `${errorMessage}: ${details}`);
  }

  return parsed.data;
}