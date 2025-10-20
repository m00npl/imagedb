import { ChunkEntity, MediaMetadata } from '../types';

interface ArkivEntity {
  id: string;
  data: string; // base64 encoded
  metadata: {
    type: 'chunk' | 'metadata';
    media_id?: string;
    chunk_index?: number;
    checksum: string;
    created_at: string;
    expiration_block: number;
  };
}

export class ArkivRpcStorage {
  private rpcUrl = process.env.ARKIV_RPC_URL || 'https://kaolin.hoodi.arkiv.network/rpc';
  private chainId = parseInt(process.env.ARKIV_CHAIN_ID || '60138453025');

  async storeChunk(chunk: ChunkEntity): Promise<void> {
    const entity: ArkivEntity = {
      id: chunk.id,
      data: chunk.data.toString('base64'),
      metadata: {
        type: 'chunk',
        media_id: chunk.media_id,
        chunk_index: chunk.chunk_index,
        checksum: chunk.checksum,
        created_at: chunk.created_at.toISOString(),
        expiration_block: chunk.expiration_block
      }
    };

    try {
      const response = await fetch(this.rpcUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'arkiv_putEntity',
          params: [entity],
          id: 1
        })
      });

      const result = await response.json();
      if (result.error) {
        throw new Error(`Arkiv error: ${result.error.message}`);
      }
    } catch (error) {
      console.error('Failed to store chunk to Arkiv:', error);
      throw error;
    }
  }

  async getChunk(media_id: string, chunk_index: number): Promise<ChunkEntity | null> {
    try {
      // Query chunks by media_id and chunk_index
      const response = await fetch(this.rpcUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'arkiv_queryEntities',
          params: [{
            filter: {
              'metadata.type': 'chunk',
              'metadata.media_id': media_id,
              'metadata.chunk_index': chunk_index
            }
          }],
          id: 1
        })
      });

      const result = await response.json();
      if (result.error) {
        throw new Error(`Arkiv error: ${result.error.message}`);
      }

      const entities = result.result;
      if (!entities || entities.length === 0) {
        return null;
      }

      const entity = entities[0];

      // Check if expired
      if (entity.metadata.expiration_block <= await this.getCurrentBlock()) {
        return null;
      }

      return {
        id: entity.id,
        media_id: entity.metadata.media_id,
        chunk_index: entity.metadata.chunk_index,
        data: Buffer.from(entity.data, 'base64'),
        checksum: entity.metadata.checksum,
        created_at: new Date(entity.metadata.created_at),
        expiration_block: entity.metadata.expiration_block
      };

    } catch (error) {
      console.error('Failed to get chunk from Arkiv:', error);
      return null;
    }
  }

  async storeMetadata(metadata: MediaMetadata): Promise<void> {
    const entity: ArkivEntity = {
      id: `metadata_${metadata.media_id}`,
      data: JSON.stringify(metadata),
      metadata: {
        type: 'metadata',
        checksum: this.calculateChecksum(JSON.stringify(metadata)),
        created_at: metadata.created_at.toISOString(),
        expiration_block: metadata.expiration_block
      }
    };

    try {
      const response = await fetch(this.rpcUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'arkiv_putEntity',
          params: [entity],
          id: 1
        })
      });

      const result = await response.json();
      if (result.error) {
        throw new Error(`Arkiv error: ${result.error.message}`);
      }
    } catch (error) {
      console.error('Failed to store metadata to Arkiv:', error);
      throw error;
    }
  }

  async getMetadata(media_id: string): Promise<MediaMetadata | null> {
    try {
      const response = await fetch(this.rpcUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'arkiv_getEntity',
          params: [`metadata_${media_id}`],
          id: 1
        })
      });

      const result = await response.json();
      if (result.error || !result.result) {
        return null;
      }

      const entity = result.result;

      // Check if expired
      if (entity.metadata.expiration_block <= await this.getCurrentBlock()) {
        return null;
      }

      return JSON.parse(entity.data);

    } catch (error) {
      console.error('Failed to get metadata from Arkiv:', error);
      return null;
    }
  }

  async getAllChunks(media_id: string): Promise<ChunkEntity[]> {
    const chunks: ChunkEntity[] = [];
    const meta = await this.getMetadata(media_id);

    if (!meta) return [];

    try {
      // Get all chunks for this media_id
      const response = await fetch(this.rpcUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'arkiv_queryEntities',
          params: [{
            filter: {
              'metadata.type': 'chunk',
              'metadata.media_id': media_id
            },
            sort: {
              'metadata.chunk_index': 1
            }
          }],
          id: 1
        })
      });

      const result = await response.json();
      if (result.error) {
        throw new Error(`Arkiv error: ${result.error.message}`);
      }

      const entities = result.result || [];

      for (const entity of entities) {
        // Check if expired
        if (entity.metadata.expiration_block <= await this.getCurrentBlock()) {
          continue;
        }

        chunks.push({
          id: entity.id,
          media_id: entity.metadata.media_id,
          chunk_index: entity.metadata.chunk_index,
          data: Buffer.from(entity.data, 'base64'),
          checksum: entity.metadata.checksum,
          created_at: new Date(entity.metadata.created_at),
          expiration_block: entity.metadata.expiration_block
        });
      }

      // Ensure we have all chunks in order
      chunks.sort((a, b) => a.chunk_index - b.chunk_index);

      // Check if we have all chunks
      if (chunks.length !== meta.chunk_count) {
        return []; // Missing chunks
      }

      return chunks;

    } catch (error) {
      console.error('Failed to get chunks from Arkiv:', error);
      return [];
    }
  }

  private async getCurrentBlock(): Promise<number> {
    try {
      const response = await fetch(this.rpcUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'eth_blockNumber',
          params: [],
          id: 1
        })
      });

      const result = await response.json();
      if (result.error) {
        throw new Error(`Arkiv error: ${result.error.message}`);
      }

      return parseInt(result.result, 16);
    } catch (error) {
      console.error('Failed to get current block from Arkiv:', error);
      // Fallback to estimated block
      return Math.floor(Date.now() / 30000); // 30s block time
    }
  }

  calculateExpirationBlock(btl_days: number): number {
    const blocksToAdd = btl_days * 2880; // 2880 blocks per day for Arkiv
    // We'll get current block when storing
    return Math.floor(Date.now() / 30000) + blocksToAdd;
  }

  private calculateChecksum(data: string): string {
    const crypto = require('crypto');
    return crypto.createHash('sha256').update(data).digest('hex');
  }
}
