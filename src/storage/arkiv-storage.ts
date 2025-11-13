import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  type Address,
  type Hex,
  type PublicArkivClient,
  type WalletArkivClient,
} from '@arkiv-network/sdk';
import { privateKeyToAccount } from '@arkiv-network/sdk/accounts';
import { eq } from '@arkiv-network/sdk/query';
import { jsonToPayload } from '@arkiv-network/sdk/utils';
import type { Entity } from '@arkiv-network/sdk/types';
import { ChunkEntity, MediaMetadata, MediaChunk } from '../types';

type BlockTimingCache = {
  currentBlock: number;
  blockDuration: number;
  updatedAt: number;
};

const BLOCK_TIME_SECONDS = 2;
const BLOCKS_PER_DAY = Math.floor(86400 / BLOCK_TIME_SECONDS);

export class ArkivStorage {
  private publicClient!: PublicArkivClient;
  private walletClient: WalletArkivClient | null = null;
  private ownerAddress: Address | null = null;
  private chainId: number;
  private rpcUrl: string;
  private wsUrl?: string;
  private initialized: Promise<void>;
  private blockTimingCache: BlockTimingCache | null = null;

  constructor() {
    this.chainId = parseInt(process.env.ARKIV_CHAIN_ID ?? '60138453025', 10);
    this.rpcUrl = process.env.ARKIV_RPC_URL ?? 'https://kaolin.hoodi.arkiv.network/rpc';
    this.wsUrl = process.env.ARKIV_WS_URL ?? 'wss://kaolin.hoodi.arkiv.network/rpc/ws';
    this.initialized = this.initializeClient();
  }

  private buildChain() {
    const httpUrls = [this.rpcUrl] as const;
    const webSocketUrls = this.wsUrl ? ([this.wsUrl] as const) : undefined;

    return defineChain({
      id: this.chainId,
      name: `arkiv-${this.chainId}`,
      network: `arkiv-${this.chainId}`,
      nativeCurrency: {
        name: 'Ether',
        symbol: 'ETH',
        decimals: 18,
      },
      rpcUrls: {
        default: {
          http: httpUrls,
          webSocket: webSocketUrls,
        },
      },
      blockExplorers: {
        default: {
          name: 'Arkiv Explorer',
          url: 'https://explorer.arkiv.network',
          apiUrl: 'https://explorer.arkiv.network/api',
        },
      },
      testnet: true,
    });
  }

  private normalizePrivateKey(key?: string | null): Hex | null {
    if (!key) return null;
    const trimmed = key.trim();
    if (!trimmed) return null;
    return (trimmed.startsWith('0x') ? trimmed : `0x${trimmed}`) as Hex;
  }

  private async initializeClient() {
    try {
      console.log('Creating Arkiv clients...');
      console.log('RPC URL:', this.rpcUrl);
      console.log('WS URL:', this.wsUrl ?? 'n/a');
      console.log('Chain ID:', this.chainId);

      const chain = this.buildChain();
      this.publicClient = createPublicClient({
        chain,
        transport: http(this.rpcUrl),
      });
      console.log('✅ Public client created successfully');

      try {
        const entityCount = await this.publicClient.getEntityCount();
        console.log('📊 Connected to Arkiv. Entity count:', entityCount);
      } catch (error) {
        console.warn('⚠️ Public client connectivity check failed:', (error as Error).message);
      }

      const privateKey = this.normalizePrivateKey(process.env.ARKIV_PRIVATE_KEY);
      if (privateKey) {
        try {
          const account = privateKeyToAccount(privateKey);
          this.ownerAddress = account.address;
          this.walletClient = createWalletClient({
            chain,
            transport: http(this.rpcUrl),
            account,
          });
          console.log('✅ Wallet client created successfully');
          console.log('📍 Owner address:', this.ownerAddress);
        } catch (error) {
          console.warn('⚠️ Wallet client initialization failed:', (error as Error).message);
          this.walletClient = null;
        }
      } else if (process.env.ARKIV_OWNER_ADDRESS) {
        this.ownerAddress = process.env.ARKIV_OWNER_ADDRESS as Address;
        console.log('ℹ️ Using provided owner address for read operations:', this.ownerAddress);
      } else {
        console.log('ℹ️ No private key or owner address configured; write and owner-specific reads are disabled');
      }

      console.log('Arkiv clients initialized successfully');
    } catch (error) {
      console.error('Failed to initialize Arkiv clients:', error);
      throw error;
    }
  }

  private async requireWalletClient(): Promise<WalletArkivClient> {
    await this.initialized;
    if (!this.walletClient) {
      throw new Error('Write operations not available - wallet client is not configured');
    }
    return this.walletClient;
  }

  private async requireOwnerAddress(): Promise<Address> {
    await this.initialized;
    if (this.ownerAddress) {
      return this.ownerAddress;
    }
    throw new Error('Owner address not configured; set ARKIV_PRIVATE_KEY or ARKIV_OWNER_ADDRESS');
  }

  private async getBlockTiming(): Promise<BlockTimingCache> {
    await this.initialized;
    const now = Date.now();
    if (this.blockTimingCache && now - this.blockTimingCache.updatedAt < 5000) {
      return this.blockTimingCache;
    }

    try {
      const timing = await this.publicClient.getBlockTiming();
      this.blockTimingCache = {
        currentBlock: Number(timing.currentBlock),
        blockDuration: timing.blockDuration,
        updatedAt: now,
      };
    } catch (error) {
      console.warn('⚠️ Failed to fetch block timing, using fallback estimate:', (error as Error).message);
      this.blockTimingCache = {
        currentBlock: Math.floor(Date.now() / (BLOCK_TIME_SECONDS * 1000)),
        blockDuration: BLOCK_TIME_SECONDS,
        updatedAt: now,
      };
    }

    return this.blockTimingCache;
  }

  private async getExpiresInSeconds(targetBlock: number): Promise<number> {
    const timing = await this.getBlockTiming();
    const currentBlock = timing.currentBlock;
    const target = Math.max(targetBlock, 0);
    const deltaBlocks = Math.max(target - currentBlock, 0);
    const expiresIn = deltaBlocks * timing.blockDuration;
    return Math.max(expiresIn, timing.blockDuration);
  }

  private entityAttribute(entity: Entity, key: string): string | number | undefined {
    const attribute = entity.attributes.find((attr) => attr.key === key);
    return attribute?.value;
  }

  async storeChunk(chunk: ChunkEntity): Promise<void> {
    await this.initialized;
    const wallet = await this.requireWalletClient();

    try {
      console.log(`📦 Storing chunk ${chunk.chunk_index} for media ${chunk.media_id}`);

      const expiresIn = await this.getExpiresInSeconds(chunk.expiration_block);
      const payload = chunk.data instanceof Buffer ? chunk.data : Buffer.from(chunk.data);

      const result = await wallet.createEntity({
        payload,
        attributes: [
          { key: 'media_id', value: chunk.media_id },
          { key: 'type', value: 'image_chunk' },
          { key: 'chunk_index', value: chunk.chunk_index + 1},
          { key: 'checksum', value: chunk.checksum },
        ],
        contentType: 'application/octet-stream',
        expiresIn,
      });

      console.log(`✅ Chunk ${chunk.chunk_index} stored with key:`, result.entityKey);
    } catch (error) {
      console.error(`Failed to store chunk ${chunk.chunk_index}:`, error);
      throw error;
    }
  }

  async getAllChunks(media_id: string): Promise<MediaChunk[]> {
    await this.initialized;

    try {
      let ownerAddress: Address;
      try {
        ownerAddress = await this.requireOwnerAddress();
      } catch {
        console.log('No owner address available for querying');
        return [];
      }
      console.log(`🔍 Querying chunks for media_id: ${media_id}`);

      const queryResult = await this.publicClient
        .buildQuery()
        .ownedBy(ownerAddress)
        .where([eq('type', 'image_chunk'), eq('media_id', media_id)])
        .withAttributes(true)
        .withMetadata(true)
        .withPayload(true)
        .limit(1000)
        .fetch();

      const chunks: MediaChunk[] = queryResult.entities.map((entity) => {
        const payload = entity.payload ? Buffer.from(entity.payload) : Buffer.alloc(0);
        const chunkIndex = Number(this.entityAttribute(entity, 'chunk_index') ?? 0);
        const checksum = String(this.entityAttribute(entity, 'checksum') ?? '');

        return {
          media_id,
          chunk_index: chunkIndex,
          data: payload.toString('base64'),
          checksum,
          expiration_block: entity.expiresAtBlock ? Number(entity.expiresAtBlock) : 0,
        };
      });

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
    const wallet = await this.requireWalletClient();

    try {
      console.log(`📋 Storing metadata for media ${metadata.media_id}`);

      const expiresIn = await this.getExpiresInSeconds(metadata.expiration_block);
      const payload = jsonToPayload({
        media_id: metadata.media_id,
        filename: metadata.filename,
        content_type: metadata.content_type,
        file_size: metadata.file_size,
        chunk_count: metadata.chunk_count,
        checksum: metadata.checksum,
        created_at: metadata.created_at.toISOString(),
        expiration_block: metadata.expiration_block,
        btl_days: metadata.btl_days,
      });

      const result = await wallet.createEntity({
        payload,
        attributes: [
          { key: 'media_id', value: metadata.media_id },
          { key: 'type', value: 'image_metadata' },
          { key: 'filename', value: metadata.filename },
          { key: 'content_type', value: metadata.content_type },
        ],
        contentType: 'application/json',
        expiresIn,
      });

      console.log('✅ Metadata stored with key:', result.entityKey);
    } catch (error) {
      console.error(`Failed to store metadata for ${metadata.media_id}:`, error);
      throw error;
    }
  }

  async getMetadata(media_id: string): Promise<MediaMetadata | null> {
    await this.initialized;

    try {
      let ownerAddress: Address;
      try {
        ownerAddress = await this.requireOwnerAddress();
      } catch {
        console.log('No owner address available for querying');
        return null;
      }
      console.log(`🔍 Querying metadata for media_id: ${media_id}`);

      const queryResult = await this.publicClient
        .buildQuery()
        .ownedBy(ownerAddress)
        .where([eq('type', 'image_metadata'), eq('media_id', media_id)])
        .withAttributes(true)
        .withMetadata(true)
        .withPayload(true)
        .limit(1)
        .fetch();

      const entity = queryResult.entities[0];
      if (!entity || !entity.payload) {
        console.log(`No metadata found for media ${media_id}`);
        return null;
      }

      const metadataJson = JSON.parse(Buffer.from(entity.payload).toString('utf8'));

      console.log(`✅ Found metadata for media ${media_id}`);
      return {
        media_id: metadataJson.media_id,
        filename: metadataJson.filename,
        content_type: metadataJson.content_type,
        file_size: metadataJson.file_size,
        chunk_count: metadataJson.chunk_count,
        checksum: metadataJson.checksum,
        created_at: new Date(metadataJson.created_at),
        expiration_block: metadataJson.expiration_block ?? (entity.expiresAtBlock ? Number(entity.expiresAtBlock) : 0),
        btl_days: metadataJson.btl_days,
      };
    } catch (error) {
      console.error(`Failed to retrieve metadata for ${media_id}:`, error);
      return null;
    }
  }

  calculateExpirationBlock(btlDays: number): number {
    const currentBlockEstimate = Math.floor(Date.now() / (BLOCK_TIME_SECONDS * 1000));
    return currentBlockEstimate + Math.floor(btlDays * BLOCKS_PER_DAY);
  }

  async getCurrentBlock(): Promise<number> {
    await this.initialized;
    try {
      const blockNumber = await this.publicClient.getBlockNumber();
      return Number(blockNumber);
    } catch (error) {
      console.error('Failed to get current block number:', error);
      const timing = await this.getBlockTiming();
      return Number(timing.currentBlock);
    }
  }

  async deleteMedia(media_id: string): Promise<void> {
    await this.initialized;
    const wallet = await this.requireWalletClient();

    try {
      const ownerAddress = await this.requireOwnerAddress();
      console.log(`🗑️ Deleting media ${media_id}`);

      const queryResult = await this.publicClient
        .buildQuery()
        .ownedBy(ownerAddress)
        .where([eq('media_id', media_id)])
        .withMetadata(true)
        .limit(500)
        .fetch();

      // Iterate through all pages and delete entities sequentially to avoid overwhelming the RPC
      // QueryResult mutates in place when next() is called, so we reuse the instance.
      let hasMore = true;
      while (hasMore) {
        for (const entity of queryResult.entities) {
          await wallet.deleteEntity({ entityKey: entity.key });
        }

        if (queryResult.hasNextPage()) {
          await queryResult.next();
        } else {
          hasMore = false;
        }
      }

      console.log(`Deleted media ${media_id} and all related entities`);
    } catch (error) {
      console.error(`Failed to delete media ${media_id}:`, error);
      throw error;
    }
  }

  async cleanupExpired(): Promise<void> {
    await this.initialized;
    try {
      const timing = await this.getBlockTiming();
  console.log(`Cleanup check at block ${timing.currentBlock} - BTL handles expiration automatically`);
    } catch (error) {
      console.error('Failed during cleanup:', error);
    }
  }
}
