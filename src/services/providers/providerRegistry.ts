import { StreamPlatform } from "@prisma/client";
import { StreamPlatformProvider } from "./streamPlatformProvider";

export class ProviderRegistry {
  private readonly providers = new Map<StreamPlatform, StreamPlatformProvider>();

  public constructor(providers: StreamPlatformProvider[]) {
    for (const provider of providers) {
      this.providers.set(provider.platform, provider);
    }
  }

  public getProvider(platform: StreamPlatform): StreamPlatformProvider {
    const provider = this.providers.get(platform);
    if (!provider) {
      throw new Error(`No stream provider registered for platform ${platform}`);
    }

    return provider;
  }
}