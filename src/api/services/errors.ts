import { FastifyRequest } from "fastify";

export class ApiError extends Error {
  public constructor(
    public readonly statusCode: number,
    message: string
  ) {
    super(message);
  }
}

export function assert(condition: unknown, statusCode: number, message: string): asserts condition {
  if (!condition) {
    throw new ApiError(statusCode, message);
  }
}

export function getSessionFromRequest(request: FastifyRequest): NonNullable<FastifyRequest["session"]> {
  if (!request.session) {
    throw new ApiError(401, "Authentication required");
  }

  return request.session;
}