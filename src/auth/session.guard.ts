import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Environment } from "../config/environment.js";
import { ApiError } from "../common/api-error.js";
import type { AuthenticatedRequest } from "./auth.types.js";
import { SessionService } from "./session.service.js";

@Injectable()
export class SessionGuard implements CanActivate {
  public constructor(
    private readonly sessions: SessionService,
    private readonly config: ConfigService<Environment, true>
  ) {}

  public async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = this.sessions.cookieFromHeader(
      request.headers.cookie,
      this.config.get("SESSION_COOKIE_NAME", { infer: true })
    );
    const user = await this.sessions.readSession(token);
    if (!user) throw new ApiError(401, "UNAUTHENTICATED", "Authentication is required");
    request.user = user;
    return true;
  }
}
