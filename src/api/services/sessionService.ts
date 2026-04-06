import { randomBytes } from "node:crypto";
import { FastifyReply, FastifyRequest } from "fastify";
import jwt, { JwtPayload, SignOptions } from "jsonwebtoken";
import { z } from "zod";
import { env } from "../../config/env";
import { requireEnvValue } from "../../config/required";
import { DashboardSession } from "../types/session";

const sessionPayloadSchema = z.object({
  userId: z.string().min(1),
  username: z.string().min(1),
  globalName: z.string().nullable(),
  avatar: z.string().nullable(),
  accessToken: z.string().min(1),
  refreshToken: z.string().nullable(),
  accessTokenExpiresAt: z.number().int().positive()
});

export class SessionService {
  private readonly jwtSecret: string;

  public constructor() {
    this.jwtSecret = requireEnvValue(env.JWT_SECRET, "JWT_SECRET");
  }

  public generateOauthState(): string {
    return randomBytes(24).toString("hex");
  }

  public setOauthStateCookie(reply: FastifyReply, state: string): void {
    reply.setCookie(env.OAUTH_STATE_COOKIE_NAME, state, {
      path: "/",
      httpOnly: true,
      secure: this.cookieSecure,
      sameSite: "lax",
      maxAge: 10 * 60,
      domain: env.COOKIE_DOMAIN
    });
  }

  public clearOauthStateCookie(reply: FastifyReply): void {
    reply.clearCookie(env.OAUTH_STATE_COOKIE_NAME, {
      path: "/",
      domain: env.COOKIE_DOMAIN
    });
  }

  public readOauthState(request: FastifyRequest): string | null {
    return request.cookies[env.OAUTH_STATE_COOKIE_NAME] ?? null;
  }

  public setSessionCookie(reply: FastifyReply, session: DashboardSession): void {
    const signOptions: SignOptions = {
      expiresIn: env.JWT_EXPIRES_IN as SignOptions["expiresIn"]
    };

    const token = jwt.sign(session, this.jwtSecret, signOptions);

    reply.setCookie(env.SESSION_COOKIE_NAME, token, {
      path: "/",
      httpOnly: true,
      secure: this.cookieSecure,
      sameSite: "lax",
      domain: env.COOKIE_DOMAIN
    });
  }

  public clearSessionCookie(reply: FastifyReply): void {
    reply.clearCookie(env.SESSION_COOKIE_NAME, {
      path: "/",
      domain: env.COOKIE_DOMAIN
    });
  }

  public readSession(request: FastifyRequest): DashboardSession | null {
    const token = request.cookies[env.SESSION_COOKIE_NAME];

    if (!token) {
      return null;
    }

    try {
      const decoded = jwt.verify(token, this.jwtSecret) as JwtPayload | string;

      if (typeof decoded === "string") {
        return null;
      }

      const parsed = sessionPayloadSchema.safeParse(decoded);
      if (!parsed.success) {
        return null;
      }

      return parsed.data;
    } catch {
      return null;
    }
  }

  private get cookieSecure(): boolean {
    return env.NODE_ENV === "production" || env.COOKIE_SECURE;
  }
}