import { BotActivityType, GlobalBotConfig } from "@prisma/client";
import {
  GlobalBotConfigRepository,
  UpdateGlobalBotConfigInput
} from "../repositories/globalBotConfigRepository";

export interface GlobalBotConfigUpdateInput {
  rotationEnabled: boolean;
  rotationIntervalSeconds: number;
  defaultStatusEnabled: boolean;
  defaultStatusText: string | null;
  defaultActivityType: BotActivityType | null;
}

export class GlobalBotConfigService {
  public constructor(private readonly globalBotConfigRepository: GlobalBotConfigRepository) {}

  public async getGlobalConfig(): Promise<GlobalBotConfig> {
    return this.globalBotConfigRepository.getOrCreate();
  }

  public async updateGlobalConfig(input: GlobalBotConfigUpdateInput): Promise<GlobalBotConfig> {
    const config = await this.globalBotConfigRepository.getOrCreate();

    const sanitizedInput: UpdateGlobalBotConfigInput = {
      rotationEnabled: input.rotationEnabled,
      rotationIntervalSeconds: input.rotationIntervalSeconds,
      defaultStatusEnabled: input.defaultStatusEnabled,
      defaultStatusText: input.defaultStatusText?.trim() ? input.defaultStatusText.trim() : null,
      defaultActivityType: input.defaultActivityType
    };

    return this.globalBotConfigRepository.update(config.id, sanitizedInput);
  }
}
