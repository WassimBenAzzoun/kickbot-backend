import { AppSetting, AppSettingKey } from "@prisma/client";
import { AppSettingRepository } from "../repositories/appSettingRepository";

export interface GuildWhitelistEnforcementState {
  enabled: boolean;
  updatedAt: Date | null;
}

const GUILD_WHITELIST_ENFORCED_KEY = AppSettingKey.GUILD_WHITELIST_ENFORCED;

function parseBooleanSetting(setting: AppSetting | null): boolean {
  if (!setting) {
    return false;
  }

  return setting.value.trim().toLowerCase() === "true";
}

export class GuildWhitelistSettingsService {
  public constructor(private readonly appSettingRepository: AppSettingRepository) {}

  public async getWhitelistEnforcementState(): Promise<GuildWhitelistEnforcementState> {
    const setting = await this.appSettingRepository.findByKey(GUILD_WHITELIST_ENFORCED_KEY);

    return {
      enabled: parseBooleanSetting(setting),
      updatedAt: setting?.updatedAt ?? null
    };
  }

  public async isWhitelistEnforced(): Promise<boolean> {
    const state = await this.getWhitelistEnforcementState();
    return state.enabled;
  }

  public async setWhitelistEnforced(enabled: boolean): Promise<GuildWhitelistEnforcementState> {
    const setting = await this.appSettingRepository.upsert(
      GUILD_WHITELIST_ENFORCED_KEY,
      enabled ? "true" : "false"
    );

    return {
      enabled: parseBooleanSetting(setting),
      updatedAt: setting.updatedAt
    };
  }
}
