import { Module } from "@nestjs/common";
import { AdminService } from "./admin/admin.service.js";
import { AdminController } from "./admin/admin.controller.js";
import { GlobalAdminGuard } from "./global-admin.guard.js";

@Module({
  providers: [AdminService, GlobalAdminGuard],
  controllers: [AdminController],
  exports: [AdminService, GlobalAdminGuard]
})
export class AdminModule {}
