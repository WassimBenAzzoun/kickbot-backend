import { FastifyReply, FastifyRequest } from "fastify";
import { GlobalAdminService } from "../../services/globalAdminService";

export function createGlobalAdminGuard(globalAdminService: GlobalAdminService) {
  return async function requireGlobalAdmin(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    const session = request.session;

    if (!session) {
      await reply.code(401).send({
        error: "Unauthorized",
        message: "Authentication is required"
      });
      return;
    }

    const isGlobalAdmin = await globalAdminService.isGlobalAdmin(session.userId);

    if (!isGlobalAdmin) {
      await reply.code(403).send({
        error: "Forbidden",
        message: "Global admin access is required"
      });
      return;
    }
  };
}
