import type { FastifyRequest } from "fastify";

export interface SessionUser {
  id: string;
  username: string;
  globalName: string | null;
  avatar: string | null;
  accessToken: string;
}

export interface AuthenticatedRequest extends FastifyRequest {
  user: SessionUser;
}

export interface DiscordGuildSummary {
  id: string;
  name: string;
  icon: string | null;
  permissions: string;
}
