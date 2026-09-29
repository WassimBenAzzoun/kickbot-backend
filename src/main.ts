import "reflect-metadata";
import { ConsoleLogger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "./app.module.js";
import { corsOrigins, type Environment } from "./config/environment.js";
import { configureOpenApi } from "./openapi.js";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
    logger: new ConsoleLogger({ json: true, prefix: "KickBot" })
  });
  const config = app.get<ConfigService<Environment, true>>(ConfigService);
  const origins = corsOrigins(config.get("CORS_ORIGINS", { infer: true }));

  app.useSecurityHeaders({
    contentSecurityPolicy:
      config.get("NODE_ENV", { infer: true }) === "development"
        ? { directives: { upgradeInsecureRequests: null } }
        : true
  });
  app.enableCsrfProtection({ trustedOrigins: origins });
  app.enableCors({
    origin: origins,
    credentials: true,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"]
  });
  app.setGlobalPrefix("api/v1");
  app.enableShutdownHooks();

  configureOpenApi(app, {
    sessionCookieName: config.get("SESSION_COOKIE_NAME", { infer: true }),
    uiEnabled: config.get("SWAGGER_UI_ENABLED", { infer: true })
  });

  await app.listen(config.get("PORT", { infer: true }), "0.0.0.0");
}

void bootstrap();
