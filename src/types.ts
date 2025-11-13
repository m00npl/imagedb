export interface ChunkEntity {
  id: string;
  media_id: string;
  chunk_index: number;
  data: Buffer;
  checksum: string;
  created_at: Date;
  expiration_block: number;
}

export interface MediaChunk {
  media_id: string;
  chunk_index: number;
  data: string; // Base64 encoded data
  checksum: string;
  expiration_block: number;
}

export interface MediaMetadata {
  media_id: string;
  filename: string;
  content_type: string;
  file_size: number;
  chunk_count: number;
  checksum: string;
  created_at: Date;
  expiration_block: number;
  btl_days: number;
}

export interface UploadSession {
  media_id: string;
  idempotency_key: string;
  metadata: MediaMetadata;
  chunks_received: Set<number>;
  completed: boolean;
}

export interface QuotaInfo {
  used_bytes: number;
  max_bytes: number;
  uploads_today: number;
  max_uploads_per_day: number;
}

export const CONFIG = {
  MAX_FILE_SIZE: 25 * 1024 * 1024, // 25 MB
  CHUNK_SIZE: 64 * 1024, // 64 KB per chunk
  DEFAULT_BTL_DAYS: 7,
  FREE_TIER_MAX_BYTES: 100 * 1024 * 1024, // 100 MB
  FREE_TIER_MAX_UPLOADS_PER_DAY: 10,
  BLOCKS_PER_DAY: 43200 // Arkiv block timing (2-second blocks)
};