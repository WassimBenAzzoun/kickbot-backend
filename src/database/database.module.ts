import { Global, Module } from "@nestjs/common";
import { AdminAccessService } from "../admin/admin-access.service.js";
import { PrismaService } from "./prisma.service.js";

@Global()
@Module({
  providers: [PrismaService, AdminAccessService],
  exports: [PrismaService, AdminAccessService]
})
export class DatabaseModule {}
