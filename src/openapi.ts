import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from "@nestjs/swagger";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";

export interface OpenApiOptions {
  sessionCookieName: string;
  uiEnabled: boolean;
}

export function configureOpenApi(
  app: NestFastifyApplication,
  options: OpenApiOptions
): () => OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle("KickBot Backend API")
    .setDescription(
      "HTTP management API for the unified KickBot backend. Authenticate through Discord OAuth, then send the encrypted session cookie on protected requests."
    )
    .setVersion("2.0.0")
    .setLicense("MIT", "https://opensource.org/license/mit")
    .addTag("Authentication", "Discord OAuth and encrypted session management")
    .addTag("Bot", "Discord bot installation")
    .addTag("Guilds", "Guild configuration, tracked streamers, and notification history")
    .addTag("Instants", "Myinstants search and Discord voice playback")
    .addTag("Administration", "Global bot configuration and guild administration")
    .addTag("Administration - Instants", "Global instant playback access and settings")
    .addTag("Health", "Process and dependency health checks")
    .addCookieAuth(
      options.sessionCookieName,
      { type: "apiKey", description: "Encrypted JWE session cookie issued by Discord OAuth" },
      "sessionCookie"
    )
    .build();
  const documentFactory = () =>
    SwaggerModule.createDocument(app, config, {
      autoTagControllers: false,
      operationIdFactory: (controller, method) =>
        `${controller.replace(/Controller$/, "")}_${method}`
    });

  SwaggerModule.setup("api/docs", app, documentFactory, {
    ui: options.uiEnabled,
    raw: ["json"],
    jsonDocumentUrl: "/api/docs-json",
    customSiteTitle: "KickBot API documentation",
    swaggerOptions: {
      displayRequestDuration: true,
      filter: true,
      persistAuthorization: true,
      tagsSorter: "alpha",
      operationsSorter: "alpha"
    }
  });

  return documentFactory;
}
