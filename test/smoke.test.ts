import { describe, test, expect } from "bun:test";

const BASE_URL = process.env.TEST_BASE_URL || 'https://imagedb.online';

describe("Smoke Tests", () => {
  test("Health endpoint should return healthy status", async () => {
    const response = await fetch(`${BASE_URL}/health`);
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.status).toBe('healthy');
    expect(data.timestamp).toBeDefined();
  });

  test("Homepage should be accessible", async () => {
    const response = await fetch(BASE_URL);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
  });

  test("Upload endpoint should reject request without file", async () => {
    const formData = new FormData();

    const response = await fetch(`${BASE_URL}/media`, {
      method: 'POST',
      body: formData
    });

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBe('No file provided');
  });

  test("Upload endpoint should accept valid PNG file format", async () => {
    // Create a small test image (1x1 pixel PNG)
    const testImageData = new Uint8Array([
      0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
      0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4,
      0x89, 0x00, 0x00, 0x00, 0x0A, 0x49, 0x44, 0x41,
      0x54, 0x78, 0x9C, 0x63, 0x00, 0x01, 0x00, 0x00,
      0x05, 0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4, 0x00,
      0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE,
      0x42, 0x60, 0x82
    ]);

    const formData = new FormData();
    const file = new File([testImageData], 'smoke-test.png', { type: 'image/png' });
    formData.append('file', file);

    // Try to upload - may fail due to quota, but should not return 500
    const uploadResponse = await fetch(`${BASE_URL}/media`, {
      method: 'POST',
      body: formData,
      headers: {
        'Idempotency-Key': `smoke-test-${Date.now()}`
      }
    });

    // Accept either success (200) or quota limit (400), but not server error (500)
    expect([200, 400]).toContain(uploadResponse.status);

    const uploadData = await uploadResponse.json();

    // If successful, should have media_id
    if (uploadResponse.status === 200) {
      expect(uploadData.media_id).toBeDefined();
      expect(uploadData.message).toBe('Upload successful');
    }

    // If quota exceeded, should have meaningful error
    if (uploadResponse.status === 400) {
      expect(uploadData.error).toBeDefined();
    }
  }, 10000); // 10 second timeout

  test("Quota endpoint should return quota information", async () => {
    const response = await fetch(`${BASE_URL}/quota`);
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.used_bytes).toBeDefined();
    expect(data.max_bytes).toBeDefined();
    expect(data.uploads_today).toBeDefined();
    expect(data.max_uploads_per_day).toBeDefined();
    expect(data.usage_percentage).toBeDefined();
  });

  test("Non-existent media should return 404", async () => {
    const fakeMediaId = 'non-existent-media-id-12345';
    const response = await fetch(`${BASE_URL}/media/${fakeMediaId}`, {
      signal: AbortSignal.timeout(10000) // 10 second timeout
    });
    expect(response.status).toBe(404);
  }, 15000);
});
