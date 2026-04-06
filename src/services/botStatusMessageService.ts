import { BotActivityType, BotStatusMessage } from "@prisma/client";
import {
  BotStatusMessageRepository,
  ReorderBotStatusMessageInput
} from "../repositories/botStatusMessageRepository";

export interface CreateBotStatusInput {
  text: string;
  activityType: BotActivityType;
  isEnabled: boolean;
  usePlaceholders: boolean;
}

export interface UpdateBotStatusInput {
  text: string;
  activityType: BotActivityType;
  isEnabled: boolean;
  usePlaceholders: boolean;
}

export class BotStatusMessageService {
  public constructor(private readonly botStatusMessageRepository: BotStatusMessageRepository) {}

  public async listAll(): Promise<BotStatusMessage[]> {
    return this.botStatusMessageRepository.listAll();
  }

  public async listEnabled(): Promise<BotStatusMessage[]> {
    return this.botStatusMessageRepository.listEnabled();
  }

  public async createStatusMessage(input: CreateBotStatusInput): Promise<BotStatusMessage> {
    return this.botStatusMessageRepository.create({
      text: this.sanitizeText(input.text),
      activityType: input.activityType,
      isEnabled: input.isEnabled,
      usePlaceholders: input.usePlaceholders
    });
  }

  public async updateStatusMessage(id: string, input: UpdateBotStatusInput): Promise<BotStatusMessage | null> {
    const existing = await this.botStatusMessageRepository.findById(id);
    if (!existing) {
      return null;
    }

    return this.botStatusMessageRepository.update(id, {
      text: this.sanitizeText(input.text),
      activityType: input.activityType,
      isEnabled: input.isEnabled,
      usePlaceholders: input.usePlaceholders
    });
  }

  public async toggleStatusMessage(id: string, isEnabled: boolean): Promise<BotStatusMessage | null> {
    return this.botStatusMessageRepository.setEnabled(id, isEnabled);
  }

  public async reorderStatusMessages(idsInOrder: string[]): Promise<BotStatusMessage[]> {
    const current = await this.botStatusMessageRepository.listAll();
    const existingIds = new Set(current.map((message) => message.id));

    for (const id of idsInOrder) {
      if (!existingIds.has(id)) {
        throw new Error(`Invalid status id in reorder payload: ${id}`);
      }
    }

    const orderedIds = [...idsInOrder];
    for (const message of current) {
      if (!orderedIds.includes(message.id)) {
        orderedIds.push(message.id);
      }
    }

    const updates: ReorderBotStatusMessageInput[] = orderedIds.map((id, index) => ({
      id,
      sortOrder: index
    }));

    await this.botStatusMessageRepository.reorder(updates);
    return this.botStatusMessageRepository.listAll();
  }

  public async deleteStatusMessage(id: string): Promise<boolean> {
    return this.botStatusMessageRepository.delete(id);
  }

  private sanitizeText(text: string): string {
    const trimmed = text.trim();
    if (!trimmed) {
      throw new Error("Status text cannot be empty");
    }

    return trimmed;
  }
}
