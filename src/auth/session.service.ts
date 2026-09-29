import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { HttpAdapterHost } from "@nestjs/core";
import { createHash, randomBytes } from "node:crypto";
import { EncryptJWT, jwtDecrypt } from "jose";
import { z } from "zod";
import type { Environment } from "../config/environment.js";
import type { SessionUser } from "./auth.types.js";

const sessionSchema = z.object({
  sub: z.string(),
  username: z.string(),
  globalName: z.string().nullable(),
  avatar: z.string().nullable(),
  accessToken: z.string()
});

const oauthStateSchema = z.object({ state: z.string() });

@Injectable()
export class SessionService {
  private readonly key: Uint8Array;

  public constructor(
    private readonly config: ConfigService<Environment, true>,
    private readonly adapterHost: HttpAdapterHost
  ) {
    this.key = createHash("sha256")
      .update(config.get("SESSION_ENCRYPTION_KEY", { infer: true }))
      .digest();
  }

  public async createSession(user: SessionUser): Promise<string> {
    return new EncryptJWT({
      username: user.username,
      globalName: user.globalName,
      avatar: user.avatar,
      accessToken: user.accessToken
    })
      .setProtectedHeader({ alg: "dir", enc: "A256GCM", typ: "JWT" })
      .setIssuer("kickbot-backend")
      .setAudience("kickbot-dashboard")
      .setSubject(user.id)
      .setIssuedAt()
      .setExpirationTime(
        `${this.config.get("SESSION_TTL_SECONDS", { infer: true }).toString()} seconds`
      )
      .encrypt(this.key);
  }

  public async readSession(token: string | undefined): Promise<SessionUser | null> {
    if (!token) return null;
    try {
      const { payload } = await jwtDecrypt(token, this.key, {
        issuer: "kickbot-backend",
        audience: "kickbot-dashboard"
      });
      const parsed = sessionSchema.safeParse(payload);
      if (!parsed.success) return null;
      return {
        id: parsed.data.sub,
        username: parsed.data.username,
        globalName: parsed.data.globalName,
        avatar: parsed.data.avatar,
        accessToken: parsed.data.accessToken
      };
    } catch {
      return null;
    }
  }

  public async createOAuthState(): Promise<{ state: string; token: string }> {
    const state = randomBytes(32).toString("base64url");
    const token = await new EncryptJWT({ state })
      .setProtectedHeader({ alg: "dir", enc: "A256GCM", typ: "JWT" })
      .setIssuer("kickbot-backend")
      .setAudience("discord-oauth-state")
      .setIssuedAt()
      .setExpirationTime("10 minutes")
      .encrypt(this.key);
    return { state, token };
  }

  public async verifyOAuthState(token: string | undefined, state: string): Promise<boolean> {
    if (!token) return false;
    try {
      const { payload } = await jwtDecrypt(token, this.key, {
        issuer: "kickbot-backend",
        audience: "discord-oauth-state"
      });
      const parsed = oauthStateSchema.safeParse(payload);
      return parsed.success && parsed.data.state === state;
    } catch {
      return false;
    }
  }

  public setSessionCookie(response: unknown, token: string): void {
    this.adapterHost.httpAdapter.setCookie(
      response,
      this.config.get("SESSION_COOKIE_NAME", { infer: true }),
      token,
      this.cookieOptions(this.config.get("SESSION_TTL_SECONDS", { infer: true }))
    );
  }

  public setOAuthStateCookie(response: unknown, token: string): void {
    this.adapterHost.httpAdapter.setCookie(
      response,
      this.config.get("OAUTH_STATE_COOKIE_NAME", { infer: true }),
      token,
      this.cookieOptions(600)
    );
  }

  public clearCookies(response: unknown): void {
    const options = this.cookieOptions();
    this.adapterHost.httpAdapter.clearCookie(
      response,
      this.config.get("SESSION_COOKIE_NAME", { infer: true }),
      options
    );
    this.adapterHost.httpAdapter.clearCookie(
      response,
      this.config.get("OAUTH_STATE_COOKIE_NAME", { infer: true }),
      options
    );
  }

  public cookieFromHeader(header: string | undefined, name: string): string | undefined {
    if (!header) return undefined;
    for (const segment of header.split(";")) {
      const separator = segment.indexOf("=");
      if (separator < 0) continue;
      if (segment.slice(0, separator).trim() === name) {
        return decodeURIComponent(segment.slice(separator + 1).trim());
      }
    }
    return undefined;
  }

  private cookieOptions(maxAge?: number): {
    path: string;
    domain?: string;
    maxAge?: number;
    httpOnly: boolean;
    secure: boolean;
    sameSite: "lax";
  } {
    const domain = this.config.get("COOKIE_DOMAIN", { infer: true });
    return {
      path: "/",
      ...(domain ? { domain } : {}),
      ...(maxAge ? { maxAge } : {}),
      httpOnly: true,
      secure:
        this.config.get("NODE_ENV", { infer: true }) === "production" ||
        this.config.get("COOKIE_SECURE", { infer: true }),
      sameSite: "lax"
    };
  }
}
