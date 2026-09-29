import { Injectable, OnApplicationShutdown, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";
import type { Environment } from "../config/environment.js";

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnApplicationShutdown {
  public constructor(config: ConfigService<Environment, true>) {
    super({
      adapter: new PrismaPg({ connectionString: config.get("DATABASE_URL", { infer: true }) })
    });
  }

  public async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  public async onApplicationShutdown(): Promise<void> {
    await this.$disconnect();
  }
}
