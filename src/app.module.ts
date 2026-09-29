import "dotenv/config";
import {
  Module,
  StandardSchemaSerializerInterceptor,
  StandardSchemaValidationPipe
} from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from "@nestjs/core";
import { ScheduleModule } from "@nestjs/schedule";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { AdminModule } from "./admin/admin.module.js";
import { AuthModule } from "./auth/auth.module.js";
import { HttpExceptionFilter } from "./common/http.filter.js";
import { RequestIdInterceptor } from "./common/request-id.interceptor.js";
import { environmentSchema, type Environment } from "./config/environment.js";
import { DatabaseModule } from "./database/database.module.js";
import { GuildsModule } from "./guilds/guilds.module.js";
import { HealthModule } from "./health/health.module.js";
import { KickModule } from "./kick/kick.module.js";
import { NotificationsModule } from "./notifications/notifications.module.js";
import { SchedulingModule } from "./scheduling/scheduling.module.js";
import { StreamersModule } from "./streamers/streamers.module.js";

const runtimeModules = process.env.DISCORD_ENABLED === "false" ? [] : [SchedulingModule];

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true, validationSchema: environmentSchema }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Environment, true>) => ({
        skipIf: (context) => context.getType() !== "http",
        throttlers: [
          {
            ttl: config.get("API_RATE_LIMIT_WINDOW_SECONDS", { infer: true }) * 1000,
            limit: config.get("API_RATE_LIMIT_MAX", { infer: true })
          }
        ]
      })
    }),
    ScheduleModule.forRoot(),
    DatabaseModule,
    AuthModule,
    GuildsModule,
    StreamersModule,
    NotificationsModule,
    AdminModule,
    KickModule,
    HealthModule,
    ...runtimeModules
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_PIPE, useClass: StandardSchemaValidationPipe },
    { provide: APP_INTERCEPTOR, useClass: StandardSchemaSerializerInterceptor },
    { provide: APP_INTERCEPTOR, useClass: RequestIdInterceptor },
    { provide: APP_FILTER, useClass: HttpExceptionFilter }
  ]
})
export class AppModule {}
