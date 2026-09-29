import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import type { AuthenticatedRequest } from "../auth/auth.types.js";
import { ApiError } from "../common/api-error.js";
import { AdminAccessService } from "./admin-access.service.js";

@Injectable()
export class GlobalAdminGuard implements CanActivate {
  public constructor(private readonly admins: AdminAccessService) {}

  public async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!(await this.admins.isAdmin(request.user.id))) {
      throw new ApiError(403, "GLOBAL_ADMIN_REQUIRED", "Global administrator access is required");
    }
    return true;
  }
}
