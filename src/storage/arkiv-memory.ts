import crypto from 'crypto';
import { ChunkEntity, MediaMetadata } from '../types';

export class ArkivMemoryStorage {
  private chunks: Map<string, ChunkEntity> = new Map();
  private metadata: Map<string, MediaMetadata> = new Map();
  private currentBlock = 1000000; // Mock current block

  async storeChunk(chunk: ChunkEntity): Promise<void> {
    const key = `${chunk.media_id}_${chunk.chunk_index}`;

    if (this.chunks.has(key)) {
      const existing = this.chunks.get(key)!;
      if (existing.checksum !== chunk.checksum) {
        throw new Error('Chunk checksum mismatch - data corruption detected');
      }
      return;
    }

    this.chunks.set(key, chunk);
  }

  async getChunk(media_id: string, chunk_index: number): Promise<ChunkEntity | null> {
    const key = `${media_id}_${chunk_index}`;
    const chunk = this.chunks.get(key);

    if (!chunk) return null;

    if (chunk.expiration_block <= this.getCurrentBlock()) {
      this.chunks.delete(key);
      return null;
    }

    return chunk;
  }

  async storeMetadata(metadata: MediaMetadata): Promise<void> {
    this.metadata.set(metadata.media_id, metadata);
  }

  async getMetadata(media_id: string): Promise<MediaMetadata | null> {
    const meta = this.metadata.get(media_id);

    if (!meta) return null;

    if (meta.expiration_block <= this.getCurrentBlock()) {
      this.metadata.delete(media_id);
      return null;
    }

    return meta;
  }

  async getAllChunks(media_id: string): Promise<ChunkEntity[]> {
    const chunks: ChunkEntity[] = [];
    const meta = await this.getMetadata(media_id);

    if (!meta) return [];

    for (let i = 0; i < meta.chunk_count; i++) {
      const chunk = await this.getChunk(media_id, i);
      if (!chunk) return []; // Missing chunk means file is incomplete
      chunks.push(chunk);
    }

    return chunks;
  }

  private getCurrentBlock(): number {
    return this.currentBlock;
  }

  calculateExpirationBlock(btl_days: number): number {
    const blocksToAdd = btl_days * 2880; // 2880 blocks per day for Arkiv
    return this.getCurrentBlock() + blocksToAdd;
  }
}
