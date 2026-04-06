import { WhitelistedGuild } from "@prisma/client";
import {
  CreateWhitelistedGuildInput,
  WhitelistedGuildRepository
} from "../repositories/whitelistedGuildRepository";

export class WhitelistedGuildAlreadyExistsError extends Error {
  public constructor(guildId: string) {
    super(`Guild ${guildId} is already whitelisted`);
  }
}

export interface AddWhitelistedGuildInput {
  guildId: string;
  guildName?: string | null;
  notes?: string | null;
  addedByUserId?: string | null;
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export class WhitelistedGuildService {
  public constructor(private readonly whitelistedGuildRepository: WhitelistedGuildRepository) {}

  public async listWhitelistedGuilds(): Promise<WhitelistedGuild[]> {
    return this.whitelistedGuildRepository.listAll();
  }

  public async isGuildWhitelisted(guildId: string): Promise<boolean> {
    const normalizedGuildId = guildId.trim();
    if (!normalizedGuildId) {
      return false;
    }

    const item = await this.whitelistedGuildRepository.findByGuildId(normalizedGuildId);
    return item !== null;
  }

  public async addWhitelistedGuild(input: AddWhitelistedGuildInput): Promise<WhitelistedGuild> {
    const guildId = input.guildId.trim();

    if (!guildId) {
      throw new Error("guildId cannot be empty");
    }

    const existing = await this.whitelistedGuildRepository.findByGuildId(guildId);
    if (existing) {
      throw new WhitelistedGuildAlreadyExistsError(guildId);
    }

    const createInput: CreateWhitelistedGuildInput = {
      guildId,
      guildName: normalizeOptionalText(input.guildName),
      notes: normalizeOptionalText(input.notes),
      addedByUserId: normalizeOptionalText(input.addedByUserId)
    };

    return this.whitelistedGuildRepository.create(createInput);
  }

  public async removeWhitelistedGuild(guildId: string): Promise<WhitelistedGuild | null> {
    const normalizedGuildId = guildId.trim();

    if (!normalizedGuildId) {
      return null;
    }

    return this.whitelistedGuildRepository.deleteByGuildId(normalizedGuildId);
  }
}
