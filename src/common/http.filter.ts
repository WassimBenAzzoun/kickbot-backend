import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger
} from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import type { FastifyRequest } from "fastify";
import { ApiError } from "./api-error.js";

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  public constructor(private readonly adapterHost: HttpAdapterHost) {}

  public catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType() !== "http") {
      this.logger.error(exception);
      return;
    }
    const context = host.switchToHttp();
    const request = context.getRequest<FastifyRequest>();
    const response = context.getResponse<unknown>();
    const requestId = request.id;

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = "INTERNAL_ERROR";
    let message = "An unexpected error occurred";
    let details: unknown;

    if (exception instanceof ApiError) {
      ({ status, code, message, details } = exception);
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      code = HttpStatus[status] ?? "HTTP_ERROR";
      const body = exception.getResponse();
      if (typeof body === "string") {
        message = body;
      } else if (body && typeof body === "object") {
        const value = body as { message?: string | string[]; error?: string };
        message = Array.isArray(value.message)
          ? value.message.join(", ")
          : (value.message ?? value.error ?? message);
        details = body;
      }
    }

    if (status >= 500) {
      this.logger.error({ requestId, path: request.url, exception });
    }

    this.adapterHost.httpAdapter.reply(
      response,
      { error: { code, message, ...(details === undefined ? {} : { details }), requestId } },
      status
    );
  }
}
