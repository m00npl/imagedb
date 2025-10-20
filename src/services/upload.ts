import { ArkivStorage } from '../storage/arkiv-storage';
import { ChunkingService } from './chunking';
import { QuotaService } from './quota';
import { CONFIG, UploadSession, MediaMetadata } from '../types';

export class UploadService {
  private storage = new ArkivStorage();
  private quotaService = new QuotaService();
  private uploadSessions: Map<string, UploadSession> = new Map();

  async initiateUpload(
    fileBuffer: Buffer,
    filename: string,
    contentType: string,
    idempotencyKey: string,
    userId: string,
    btlDays: number = CONFIG.DEFAULT_BTL_DAYS
  ): Promise<{ success: boolean; media_id?: string; error?: string }> {
    if (fileBuffer.length > CONFIG.MAX_FILE_SIZE) {
      return { success: false, error: `File too large. Max size: ${CONFIG.MAX_FILE_SIZE} bytes` };
    }

    if (!this.isValidImageType(contentType)) {
      return { success: false, error: 'Only JPEG and PNG files are supported' };
    }

    const quotaCheck = await this.quotaService.checkQuota(userId, fileBuffer.length);
    if (!quotaCheck.allowed) {
      return { success: false, error: quotaCheck.reason };
    }

    const existingSession = this.findExistingSession(idempotencyKey);
    if (existingSession) {
      return { success: true, media_id: existingSession.media_id };
    }

    const media_id = ChunkingService.generateMediaId();
    const expiration_block = this.storage.calculateExpirationBlock(btlDays);

    const metadata = ChunkingService.createMetadata(
      media_id,
      filename,
      contentType,
      fileBuffer,
      btlDays,
      expiration_block
    );

    const session: UploadSession = {
      media_id,
      idempotency_key: idempotencyKey,
      metadata,
      chunks_received: new Set(),
      completed: false
    };

    this.uploadSessions.set(idempotencyKey, session);

    const chunks = ChunkingService.chunkFile(fileBuffer, media_id, expiration_block);

    try {
      for (const chunk of chunks) {
        await this.storage.storeChunk(chunk);
        session.chunks_received.add(chunk.chunk_index);
      }

      await this.storage.storeMetadata(metadata);
      session.completed = true;

      await this.quotaService.updateUsage(userId, fileBuffer.length);

      return { success: true, media_id };
    } catch (error) {
      return { success: false, error: `Upload failed: ${error}` };
    }
  }

  async getMedia(media_id: string): Promise<{ success: boolean; buffer?: Buffer; metadata?: MediaMetadata; error?: string }> {
    try {
      const metadata = await this.storage.getMetadata(media_id);
      if (!metadata) {
        return { success: false, error: 'Media not found or expired' };
      }

      const chunks = await this.storage.getAllChunks(media_id);
      if (chunks.length === 0) {
        return { success: false, error: 'Media chunks not found or incomplete' };
      }

      // Convert MediaChunk to ChunkEntity format for reassembly
      const chunkEntities = chunks.map(chunk => ({
        id: '',
        media_id: chunk.media_id,
        chunk_index: chunk.chunk_index,
        data: typeof chunk.data === 'string' ? Buffer.from(chunk.data, 'base64') : Buffer.from(chunk.data),
        checksum: chunk.checksum,
        created_at: new Date(),
        expiration_block: chunk.expiration_block
      }));

      const reassembledBuffer = ChunkingService.reassembleFile(chunkEntities);

      if (!ChunkingService.validateFileIntegrity(metadata.checksum, reassembledBuffer)) {
        return { success: false, error: 'File integrity check failed' };
      }

      return { success: true, buffer: reassembledBuffer, metadata };
    } catch (error) {
      return { success: false, error: `Retrieval failed: ${error}` };
    }
  }

  private isValidImageType(contentType: string): boolean {
    return ['image/jpeg', 'image/png'].includes(contentType);
  }

  private findExistingSession(idempotencyKey: string): UploadSession | null {
    return this.uploadSessions.get(idempotencyKey) || null;
  }

  async getUploadStatus(idempotencyKey: string): Promise<UploadSession | null> {
    return this.uploadSessions.get(idempotencyKey) || null;
  }

  async getChunkInfo(media_id: string): Promise<{ success: boolean; chunks?: any[]; error?: string }> {
    try {
      const metadata = await this.storage.getMetadata(media_id);
      if (!metadata) {
        return { success: false, error: 'Media not found or expired' };
      }

      const chunks = await this.storage.getAllChunks(media_id);
      if (chunks.length === 0) {
        return { success: false, error: 'Media chunks not found or incomplete' };
      }

      const chunkInfo = chunks.map(chunk => ({
        chunk_index: chunk.chunk_index,
        size: typeof chunk.data === 'string' ?
          Buffer.from(chunk.data, 'base64').length :
          Buffer.from(chunk.data).length,
        checksum: chunk.checksum,
        expiration_block: chunk.expiration_block
      }));

      return {
        success: true,
        chunks: {
          metadata: {
            total_chunks: metadata.chunk_count,
            file_size: metadata.file_size,
            content_type: metadata.content_type,
            filename: metadata.filename
          },
          entities: chunkInfo
        }
      };
    } catch (error) {
      return { success: false, error: `Failed to get chunk info: ${error}` };
    }
  }
}
