import crypto from 'crypto';

function createLargeTestImage(targetSizeMB: number): Buffer {
  const targetBytes = targetSizeMB * 1024 * 1024;

  // Create a simple large buffer with repetitive pattern that compresses well
  const pattern = Buffer.from([
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG signature
    // Simple IHDR chunk for a large image
    0x00, 0x00, 0x00, 0x0D, // IHDR length (13)
    0x49, 0x48, 0x44, 0x52, // IHDR
    0x00, 0x00, 0x0F, 0xA0, // Width: 4000
    0x00, 0x00, 0x0F, 0xA0, // Height: 4000
    0x08, 0x02, 0x00, 0x00, 0x00, // bit depth, color type, compression, filter, interlace
    0x37, 0x6E, 0xF9, 0x24, // CRC (placeholder)
  ]);

  // Create large data chunk
  const remainingSize = targetBytes - pattern.length - 12; // Reserve space for IEND
  const dataChunk = crypto.randomBytes(remainingSize);

  // IEND chunk
  const iendChunk = Buffer.from([
    0x00, 0x00, 0x00, 0x00, // IEND length (0)
    0x49, 0x45, 0x4E, 0x44, // IEND
    0xAE, 0x42, 0x60, 0x82  // CRC
  ]);

  return Buffer.concat([pattern, dataChunk, iendChunk]);
}

async function testLargeImageUpload() {
  const baseUrl = 'http://localhost:3000';

  console.log('🧪 Creating 20MB test image...');
  const largeImageBuffer = createLargeTestImage(20);
  console.log(`📏 Large image size: ${largeImageBuffer.length} bytes (${(largeImageBuffer.length / 1024 / 1024).toFixed(2)} MB)`);

  const formData = new FormData();
  const blob = new Blob([largeImageBuffer], { type: 'image/png' });
  formData.append('file', blob, 'large-test-image.png');

  console.log('⬆️  Uploading large image...');
  const uploadResponse = await fetch(`${baseUrl}/media`, {
    method: 'POST',
    body: formData,
    headers: {
      'Idempotency-Key': 'large-test-upload-' + Date.now()
    }
  });

  if (!uploadResponse.ok) {
    const error = await uploadResponse.text();
    throw new Error(`Upload failed: ${uploadResponse.status} ${error}`);
  }

  const uploadResult = await uploadResponse.json();
  console.log('✅ Large upload successful:', uploadResult);

  console.log('⬇️  Retrieving large image...');
  const retrieveResponse = await fetch(`${baseUrl}/media/${uploadResult.media_id}`);

  if (!retrieveResponse.ok) {
    const error = await retrieveResponse.text();
    throw new Error(`Retrieve failed: ${retrieveResponse.status} ${error}`);
  }

  const retrievedBuffer = Buffer.from(await retrieveResponse.arrayBuffer());
  console.log(`📏 Retrieved large image size: ${retrievedBuffer.length} bytes`);

  const match = Buffer.compare(largeImageBuffer, retrievedBuffer) === 0;
  console.log(`🔍 Large image integrity check: ${match ? '✅ PASS' : '❌ FAIL'}`);

  console.log('📊 Checking quota after large upload...');
  const quotaResponse = await fetch(`${baseUrl}/quota`);
  const quota = await quotaResponse.json();
  console.log('💾 Quota usage after large upload:', quota);

  return { uploadResult, match, quota };
}

if (import.meta.main) {
  testLargeImageUpload()
    .then(() => console.log('🎉 Large image test completed successfully'))
    .catch(error => {
      console.error('💥 Large image test failed:', error);
      process.exit(1);
    });
}