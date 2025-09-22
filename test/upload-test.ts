import { createSimpleTestPNG } from './test-image';

async function testUploadAndRetrieve() {
  const baseUrl = 'http://localhost:3000';

  console.log('🧪 Creating test PNG...');
  const testImageBuffer = createSimpleTestPNG();
  console.log(`📏 Test image size: ${testImageBuffer.length} bytes`);

  const formData = new FormData();
  const blob = new Blob([testImageBuffer], { type: 'image/png' });
  formData.append('file', blob, 'test-image.png');

  console.log('⬆️  Uploading image...');
  const uploadResponse = await fetch(`${baseUrl}/media`, {
    method: 'POST',
    body: formData,
    headers: {
      'Idempotency-Key': 'test-upload-' + Date.now()
    }
  });

  if (!uploadResponse.ok) {
    throw new Error(`Upload failed: ${uploadResponse.status} ${await uploadResponse.text()}`);
  }

  const uploadResult = await uploadResponse.json();
  console.log('✅ Upload successful:', uploadResult);

  console.log('⬇️  Retrieving image...');
  const retrieveResponse = await fetch(`${baseUrl}/media/${uploadResult.media_id}`);

  if (!retrieveResponse.ok) {
    throw new Error(`Retrieve failed: ${retrieveResponse.status} ${await retrieveResponse.text()}`);
  }

  const retrievedBuffer = Buffer.from(await retrieveResponse.arrayBuffer());
  console.log(`📏 Retrieved image size: ${retrievedBuffer.length} bytes`);

  const match = Buffer.compare(testImageBuffer, retrievedBuffer) === 0;
  console.log(`🔍 Image integrity check: ${match ? '✅ PASS' : '❌ FAIL'}`);

  console.log('📊 Checking quota...');
  const quotaResponse = await fetch(`${baseUrl}/quota`);
  const quota = await quotaResponse.json();
  console.log('💾 Quota usage:', quota);

  return { uploadResult, match, quota };
}

if (import.meta.main) {
  testUploadAndRetrieve()
    .then(() => console.log('🎉 Test completed successfully'))
    .catch(error => {
      console.error('💥 Test failed:', error);
      process.exit(1);
    });
}