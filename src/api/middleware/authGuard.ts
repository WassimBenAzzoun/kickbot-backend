import { FastifyReply, FastifyRequest } from "fastify";
import { SessionService } from "../services/sessionService";

export function createAuthGuard(sessionService: SessionService) {
  return async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const session = sessionService.readSession(request);

    if (!session) {
      request.session = null;
      await reply.code(401).send({
        error: "Unauthorized",
        message: "Authentication is required"
      });
      return;
    }

    request.session = session;
  };
}