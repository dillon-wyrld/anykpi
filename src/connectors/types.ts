import type { SourceConfig } from "@/core/sources";

export type SyncOpts = {
  cursor?: string;
  /** Decrypted per-source config from the sources store. */
  config?: SourceConfig;
};
