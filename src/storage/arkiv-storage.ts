import { createROClient, createClient } from 'arkiv-sdk';
import { randomBytes } from 'crypto';
import { MediaMetadata, MediaChunk } from '../types';

export class ArkivStorage {
  private roClient: any;
  private writeClient: any;
  private chainId: number;
  private rpcUrl: string;
  private wsUrl: string;
  private initialized: Promise<void>;

  constructor() {
    this.chainId = parseInt(process.env.ARKIV_CHAIN_ID || '60138453025');
    this.rpcUrl = process.env.ARKIV_RPC_URL || 'https://kaolin.hoodi.arkiv.network/rpc';
    this.wsUrl = process.env.ARKIV_WS_URL || 'wss://https://kaolin.hoodi.arkiv.network/rpc/ws';
    this.initialized = this.initializeClient();
  }

  private async initializeClient() {
    try {
      console.log('Creating Arkiv clients...');
      console.log('RPC URL:', this.rpcUrl);
      console.log('WS URL:', this.wsUrl);
      console.log('Chain ID:', this.chainId);

      // Initialize read-only client (always works)
      this.roClient = createROClient(this.chainId, this.rpcUrl, this.wsUrl);
      console.log('✅ Read-only client created successfully');

      // Test read connection
      try {
        const entityCount = await this.roClient.getEntityCount();
        console.log('📊 Connected to Arkiv. Entity count:', entityCount);
      } catch (e) {
        console.warn('⚠️ Read test failed but client created:', e.message);
      }

      // Try to initialize write client (for create operations)
      if (process.env.ARKIV_PRIVATE_KEY) {
        try {
          const accountData = {
            tag: 'privatekey',
            data: Buffer.from(process.env.ARKIV_PRIVATE_KEY.slice(2), 'hex')
          };
          this.writeClient = await createClient(this.chainId, accountData, this.rpcUrl, this.wsUrl);
          console.log('✅ Write client created successfully');

          const ownerAddress = await this.writeClient.getOwnerAddress();
          console.log('📍 Owner address:', ownerAddress);
        } catch (e) {
          console.warn('⚠️ Write client failed, using read-only mode:', e.message);
          this.writeClient = null;
        }
      } else {
        console.log('ℹ️ No private key provided, using read-only mode');
        this.writeClient = null;
      }

      console.log('Arkiv clients initialized successfully');
    } catch (error) {
      console.error('Failed to initialize Arkiv clients:', error);
      throw error;
    }
  }

  async storeChunk(chunk: MediaChunk): Promise<void> {
    await this.initialized;

    if (!this.writeClient) {
      throw new Error('Write operations not available - no private key configured');
    }

    try {
      console.log(`📦 Storing chunk ${chunk.chunk_index} for media ${chunk.media_id}`);

      const currentBlock = await this.getCurrentBlock();
      const result = await this.writeClient.createEntities([{
        btl: Number(chunk.expiration_block) - Number(currentBlock),
        data: Buffer.from(chunk.data, 'base64'),
        stringAnnotations: [
          { key: 'media_id', value: chunk.media_id || '' },
          { key: 'type', value: 'image_chunk' },
          { key: 'chunk_index', value: chunk.chunk_index.toString() },
          { key: 'checksum', value: chunk.checksum || '' }
        ],
        numericAnnotations: []
      }]);

      console.log(`✅ Chunk ${chunk.chunk_index} stored with key:`, result[0].entityKey);
    } catch (error) {
      console.error(`Failed to store chunk ${chunk.chunk_index}:`, error);
      throw error;
    }
  }

  async getAllChunks(media_id: string): Promise<MediaChunk[]> {
    await this.initialized;
    try {
      console.log(`🔍 Querying chunks for media_id: ${media_id}`);

      // Query for image chunks with specific media_id
      // Note: We can't use complex queries yet, so we'll get all entities and filter
      const ownerAddress = this.writeClient ? await this.writeClient.getOwnerAddress() : null;

      if (!ownerAddress) {
        console.log('No owner address available for querying');
        return [];
      }

      // Get all our entities and filter for chunks
      const allEntities = await this.roClient.getEntitiesOfOwner(ownerAddress);
      console.log(`Found ${allEntities.length} total entities for owner`);

      const chunks: MediaChunk[] = [];

      for (const entityKey of allEntities) {
        try {
          const metadata = await this.roClient.getEntityMetaData(entityKey);

          // Check if this is an image chunk for our media_id
          const isChunk = metadata.stringAnnotations.some(
            (ann: any) => ann.key === 'type' && ann.value === 'image_chunk'
          );
          const matchesMediaId = metadata.stringAnnotations.some(
            (ann: any) => ann.key === 'media_id' && ann.value === media_id
          );

          if (isChunk && matchesMediaId) {
            const data = await this.roClient.getStorageValue(entityKey);
            const chunkIndexAnn = metadata.stringAnnotations.find(
              (ann: any) => ann.key === 'chunk_index'
            );
            const checksumAnn = metadata.stringAnnotations.find(
              (ann: any) => ann.key === 'checksum'
            );

            chunks.push({
              media_id,
              chunk_index: parseInt(chunkIndexAnn?.value || '0'),
              data: data, // Keep as Buffer for reassembly
              checksum: checksumAnn?.value || '',
              expiration_block: metadata.expiresAtBlock
            });
          }
        } catch (e) {
          console.warn(`Failed to process entity ${entityKey}:`, e.message);
        }
      }

      // Sort chunks by index
      chunks.sort((a, b) => a.chunk_index - b.chunk_index);

      console.log(`✅ Found ${chunks.length} chunks for media ${media_id}`);
      return chunks;
    } catch (error) {
      console.error(`Failed to retrieve chunks for media ${media_id}:`, error);
      throw error;
    }
  }

  async storeMetadata(metadata: MediaMetadata): Promise<void> {
    await this.initialized;

    if (!this.writeClient) {
      throw new Error('Write operations not available - no private key configured');
    }

    try {
      console.log(`📋 Storing metadata for media ${metadata.media_id}`);

      const metadataJson = JSON.stringify({
        media_id: metadata.media_id,
        filename: metadata.filename,
        content_type: metadata.content_type,
        file_size: metadata.file_size,
        chunk_count: metadata.chunk_count,
        checksum: metadata.checksum,
        created_at: metadata.created_at,
        btl_days: metadata.btl_days
      });

      const currentBlock = await this.getCurrentBlock();
      const result = await this.writeClient.createEntities([{
        btl: Number(metadata.expiration_block) - Number(currentBlock),
        data: Buffer.from(metadataJson, 'utf8'),
        stringAnnotations: [
          { key: 'media_id', value: metadata.media_id || '' },
          { key: 'type', value: 'image_metadata' },
          { key: 'filename', value: metadata.filename || '' },
          { key: 'content_type', value: metadata.content_type || '' }
        ],
        numericAnnotations: []
      }]);

      console.log(`✅ Metadata stored with key:`, result[0].entityKey);
    } catch (error) {
      console.error(`Failed to store metadata for ${metadata.media_id}:`, error);
      throw error;
    }
  }

  async getMetadata(media_id: string): Promise<MediaMetadata | null> {
    await this.initialized;
    try {
      console.log(`🔍 Querying metadata for media_id: ${media_id}`);

      const ownerAddress = this.writeClient ? await this.writeClient.getOwnerAddress() : null;

      if (!ownerAddress) {
        console.log('No owner address available for querying');
        return null;
      }

      // Get all our entities and look for metadata
      const allEntities = await this.roClient.getEntitiesOfOwner(ownerAddress);

      for (const entityKey of allEntities) {
        try {
          const entityMetadata = await this.roClient.getEntityMetaData(entityKey);

          // Check if this is metadata for our media_id
          const isMetadata = entityMetadata.stringAnnotations.some(
            (ann: any) => ann.key === 'type' && ann.value === 'image_metadata'
          );
          const matchesMediaId = entityMetadata.stringAnnotations.some(
            (ann: any) => ann.key === 'media_id' && ann.value === media_id
          );

          if (isMetadata && matchesMediaId) {
            const data = await this.roClient.getStorageValue(entityKey);
            const metadataJson = JSON.parse(Buffer.from(data).toString('utf8'));

            console.log(`✅ Found metadata for media ${media_id}`);
            return {
              media_id: metadataJson.media_id,
              filename: metadataJson.filename,
              content_type: metadataJson.content_type,
              file_size: metadataJson.file_size,
              chunk_count: metadataJson.chunk_count,
              checksum: metadataJson.checksum,
              created_at: new Date(metadataJson.created_at),
              expiration_block: entityMetadata.expiresAtBlock,
              btl_days: metadataJson.btl_days
            };
          }
        } catch (e) {
          console.warn(`Failed to process entity ${entityKey}:`, e.message);
        }
      }

      console.log(`No metadata found for media ${media_id}`);
      return null;
    } catch (error) {
      console.error(`Failed to retrieve metadata for ${media_id}:`, error);
      return null;
    }
  }

  calculateExpirationBlock(btlDays: number): number {
    // Calculate expiration block based on BTL days
    // Assuming ~15 second block time on Holesky
    const currentBlock = Math.floor(Date.now() / 1000 / 15);
    const blocksPerDay = (24 * 60 * 60) / 15; // ~5760 blocks per day
    return currentBlock + Math.floor(btlDays * blocksPerDay);
  }

  async getCurrentBlock(): Promise<number> {
    await this.initialized;
    try {
      // Use write client to get block number, fallback to calculation
      if (this.writeClient && this.writeClient.getRawClient) {
        const rawClient = this.writeClient.getRawClient();
        const blockNumber = await rawClient.httpClient.getBlockNumber();
        return blockNumber;
      }

      // Fallback calculation based on time
      return Math.floor(Date.now() / 1000 / 15);
    } catch (error) {
      console.error('Failed to get current block number:', error);
      // Fallback calculation
      return Math.floor(Date.now() / 1000 / 15);
    }
  }

  async deleteMedia(media_id: string): Promise<void> {
    await this.initialized;
    try {
      // Query and delete all chunks
      const chunks = await this.entities.ImageChunk.query({
        annotations: {
          media_id: media_id
        }
      });

      for (const chunk of chunks) {
        await chunk.delete();
      }

      // Query and delete metadata
      const metadataEntities = await this.entities.ImageMetadata.query({
        annotations: {
          media_id: media_id
        }
      });

      for (const metadata of metadataEntities) {
        await metadata.delete();
      }

      console.log(`Deleted media ${media_id} and all chunks`);
    } catch (error) {
      console.error(`Failed to delete media ${media_id}:`, error);
      throw error;
    }
  }

  // Cleanup expired entries (optional - Arkiv should handle this automatically with BTL)
  async cleanupExpired(): Promise<void> {
    await this.initialized;
    try {
      const currentBlock = await this.getCurrentBlock();

      // This is optional since BTL should handle expiration automatically
      console.log(`Cleanup check at block ${currentBlock} - BTL should handle expiration automatically`);
    } catch (error) {
      console.error('Failed during cleanup:', error);
    }
  }
}
