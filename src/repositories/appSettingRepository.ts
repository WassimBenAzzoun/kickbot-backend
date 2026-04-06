import { AppSetting, AppSettingKey, PrismaClient } from "@prisma/client";

export class AppSettingRepository {
  public constructor(private readonly prisma: PrismaClient) {}

  public async findByKey(key: AppSettingKey): Promise<AppSetting | null> {
    return this.prisma.appSetting.findUnique({
      where: {
        key
      }
    });
  }

  public async upsert(key: AppSettingKey, value: string): Promise<AppSetting> {
    return this.prisma.appSetting.upsert({
      where: {
        key
      },
      create: {
        key,
        value
      },
      update: {
        value
      }
    });
  }
}
