import { Injectable } from "@nestjs/common";
import { ApiError } from "../../common/api-error.js";
import { PrismaService } from "../../database/prisma.service.js";

@Injectable()
export class NotificationsService {
  public constructor(private readonly prisma: PrismaService) {}

  public async list(guildId: string, cursor: string | undefined, limit: number) {
    const decoded = cursor ? decodeCursor(cursor) : undefined;
    const rows = await this.prisma.notification.findMany({
      where: {
        guildId,
        sentAt: { not: null },
        ...(decoded
          ? {
              OR: [
                { sentAt: { lt: decoded.sentAt } },
                { sentAt: decoded.sentAt, id: { lt: decoded.id } }
              ]
            }
          : {})
      },
      orderBy: [{ sentAt: "desc" }, { id: "desc" }],
      take: limit + 1
    });
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const last = items.at(-1);
    return {
      items,
      page: {
        nextCursor: hasMore && last?.sentAt ? encodeCursor(last.sentAt, last.id) : null,
        hasMore
      }
    };
  }
}

function encodeCursor(sentAt: Date, id: string): string {
  return Buffer.from(JSON.stringify({ sentAt: sentAt.toISOString(), id }), "utf8").toString(
    "base64url"
  );
}

function decodeCursor(cursor: string): { sentAt: Date; id: string } {
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as {
      sentAt?: unknown;
      id?: unknown;
    };
    if (typeof value.sentAt !== "string" || typeof value.id !== "string") throw new Error();
    const sentAt = new Date(value.sentAt);
    if (Number.isNaN(sentAt.valueOf())) throw new Error();
    return { sentAt, id: value.id };
  } catch {
    throw new ApiError(400, "INVALID_CURSOR", "Notification cursor is invalid");
  }
}
