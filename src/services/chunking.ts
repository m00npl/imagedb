import crypto from 'crypto';
import { CONFIG, ChunkEntity, MediaMetadata } from '../types';

export class ChunkingService {
  static generateMediaId(): string {
    return crypto.randomUUID();
  }

  static calculateChecksum(data: Buffer): string {
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  static chunkFile(fileBuffer: Buffer, media_id: string, expiration_block: number): ChunkEntity[] {
    const chunks: ChunkEntity[] = [];
    const chunkSize = CONFIG.CHUNK_SIZE;

    for (let i = 0; i < fileBuffer.length; i += chunkSize) {
      const chunkData = fileBuffer.subarray(i, i + chunkSize);
      const chunk_index = Math.floor(i / chunkSize);

      const chunk: ChunkEntity = {
        id: crypto.randomUUID(),
        media_id,
        chunk_index,
        data: chunkData,
        checksum: this.calculateChecksum(chunkData),
        created_at: new Date(),
        expiration_block
      };

      chunks.push(chunk);
    }

    return chunks;
  }

  static createMetadata(
    media_id: string,
    original_filename: string,
    content_type: string,
    fileBuffer: Buffer,
    btl_days: number,
    expiration_block: number
  ): MediaMetadata {
    const chunk_count = Math.ceil(fileBuffer.length / CONFIG.CHUNK_SIZE);

    return {
      media_id,
      filename: original_filename,
      content_type,
      file_size: fileBuffer.length,
      chunk_count,
      checksum: this.calculateChecksum(fileBuffer),
      created_at: new Date(),
      expiration_block,
      btl_days
    };
  }

  static reassembleFile(chunks: ChunkEntity[]): Buffer {
    chunks.sort((a, b) => a.chunk_index - b.chunk_index);

    const buffers = chunks.map(chunk => chunk.data);
    return Buffer.concat(buffers);
  }

  static validateFileIntegrity(originalChecksum: string, reassembledBuffer: Buffer): boolean {
    const reassembledChecksum = this.calculateChecksum(reassembledBuffer);
    return originalChecksum === reassembledChecksum;
  }
}