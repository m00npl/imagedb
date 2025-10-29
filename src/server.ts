import { config } from 'dotenv';
config();

import * as Sentry from '@sentry/node';

// Initialize Sentry
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'production',
    tracesSampleRate: 1.0,
  });
  console.log('✅ Sentry initialized');
}

import { Hono } from 'hono';
import { serveStatic } from 'hono/bun';
import { UploadService } from './services/upload';
import { QuotaService } from './services/quota';

const app = new Hono();
const uploadService = new UploadService();
const quotaService = new QuotaService();

// Serve static files (documentation site)
app.use('/*', serveStatic({ root: './public' }));

app.post('/media', async (c) => {
  try {
    const formData = await c.req.formData();
    const file = formData.get('file') as File;
    const idempotencyKey = c.req.header('Idempotency-Key') || crypto.randomUUID();
    const btlDays = parseInt(c.req.header('BTL-Days') || '7');

    if (!file) {
      return c.json({ error: 'No file provided' }, 400);
    }

    const fileBuffer = Buffer.from(await file.arrayBuffer());
    const userId = quotaService.getUserId(c.req);

    const result = await uploadService.initiateUpload(
      fileBuffer,
      file.name,
      file.type,
      idempotencyKey,
      userId,
      btlDays
    );

    if (!result.success) {
      return c.json({ error: result.error }, 400);
    }

    return c.json({
      media_id: result.media_id,
      message: 'Upload successful'
    });
  } catch (error) {
    console.error('Upload error:', error);
    Sentry.captureException(error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

app.get('/media/:media_id', async (c) => {
  try {
    const media_id = c.req.param('media_id');

    const result = await uploadService.getMedia(media_id);

    if (!result.success) {
      return c.json({ error: result.error }, result.error?.includes('not found') ? 404 : 500);
    }

    const { buffer, metadata } = result;

    if (!metadata) {
      return c.json({ error: 'Metadata missing from result' }, 500);
    }

    console.log('📤 Serving media:', media_id, 'size:', buffer?.length, 'bytes');

    return new Response(buffer, {
      headers: {
        'Content-Type': metadata.content_type,
        'Content-Length': metadata.file_size.toString(),
        'Content-Disposition': `inline; filename="${metadata.filename}"`,
        'Cache-Control': 'public, max-age=86400'
      }
    });
  } catch (error) {
    console.error('Retrieval error:', error);
    Sentry.captureException(error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

app.get('/quota', async (c) => {
  try {
    const userId = quotaService.getUserId(c.req);
    const quota = await quotaService.getQuotaInfo(userId);

    return c.json({
      used_bytes: quota.used_bytes,
      max_bytes: quota.max_bytes,
      uploads_today: quota.uploads_today,
      max_uploads_per_day: quota.max_uploads_per_day,
      usage_percentage: (quota.used_bytes / quota.max_bytes * 100).toFixed(2)
    });
  } catch (error) {
    console.error('Quota error:', error);
    Sentry.captureException(error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

app.get('/status/:idempotency_key', async (c) => {
  try {
    const idempotencyKey = c.req.param('idempotency_key');
    const session = await uploadService.getUploadStatus(idempotencyKey);

    if (!session) {
      return c.json({ error: 'Upload session not found' }, 404);
    }

    return c.json({
      media_id: session.media_id,
      completed: session.completed,
      chunks_received: session.chunks_received.size,
      total_chunks: session.metadata.chunk_count
    });
  } catch (error) {
    console.error('Status error:', error);
    Sentry.captureException(error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

app.get('/chunks/:media_id', async (c) => {
  try {
    const media_id = c.req.param('media_id');
    const chunks = await uploadService.getChunkInfo(media_id);

    if (!chunks.success) {
      return c.json({ error: chunks.error }, 404);
    }

    return c.json({
      media_id: media_id,
      chunks: chunks.chunks
    });
  } catch (error) {
    console.error('Chunks info error:', error);
    Sentry.captureException(error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

app.get('/health', (c) => {
  return c.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

const port = parseInt(process.env.PORT || '3000');

console.log(`🚀 Images DB service starting on port ${port}`);

export default {
  port,
  fetch: app.fetch,
};