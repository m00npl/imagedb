// Demo functionality for the ImageDB documentation site

class ImageDBDemo {
  constructor() {
    // Use current host for demo
    const baseUrl = window.location.origin;
    this.client = new ImageDB(baseUrl);
    this.currentMediaId = null;
    this.initializeEventListeners();
  }

  initializeEventListeners() {
    const uploadBtn = document.getElementById('uploadBtn');
    const imageInput = document.getElementById('imageInput');
    const downloadBtn = document.getElementById('downloadBtn');

    if (uploadBtn) {
      uploadBtn.addEventListener('click', () => this.handleUpload());
    }

    if (imageInput) {
      imageInput.addEventListener('change', () => this.handleFileSelection());
    }

    if (downloadBtn) {
      downloadBtn.addEventListener('click', () => this.handleDownload());
    }
  }

  handleFileSelection() {
    const input = document.getElementById('imageInput');
    const uploadBtn = document.getElementById('uploadBtn');

    if (input.files && input.files[0]) {
      const file = input.files[0];
      const validation = ImageDB.validateFile(file);

      if (validation.valid) {
        uploadBtn.disabled = false;
        uploadBtn.textContent = `Upload ${file.name}`;
        this.hideResults();
      } else {
        uploadBtn.disabled = true;
        uploadBtn.textContent = 'Invalid File';
        this.showError(validation.errors.join(', '));
      }
    } else {
      uploadBtn.disabled = true;
      uploadBtn.textContent = 'Upload Image';
    }
  }

  async handleUpload() {
    const input = document.getElementById('imageInput');
    const file = input.files[0];

    if (!file) {
      this.showError('Please select a file first');
      return;
    }

    this.showUploading();

    try {
      const idempotencyKey = ImageDB.generateIdempotencyKey();

      // Upload the file
      const result = await this.client.upload(file, {
        idempotencyKey: idempotencyKey,
        ttlDays: 7
      });

      this.currentMediaId = result.media_id;

      // Retrieve the image to verify integrity
      const retrievedBlob = await this.client.get(result.media_id);
      const imageUrl = URL.createObjectURL(retrievedBlob);

      // Calculate chunk count (approximate)
      const chunkSize = 64 * 1024; // 64KB chunks
      const chunkCount = Math.ceil(file.size / chunkSize);

      // Get chunk information from the server
      const chunkInfo = await this.getChunkInfo(result.media_id);

      this.showSuccess({
        mediaId: result.media_id,
        fileSize: this.formatFileSize(file.size),
        chunkCount: chunkCount,
        imageUrl: imageUrl,
        originalFile: file,
        chunkInfo: chunkInfo
      });

    } catch (error) {
      this.showError(error.message);
    }
  }

  async handleDownload() {
    if (!this.currentMediaId) {
      this.showError('No image to download');
      return;
    }

    try {
      await this.client.download(this.currentMediaId, 'retrieved-image');
    } catch (error) {
      this.showError(`Download failed: ${error.message}`);
    }
  }

  showUploading() {
    this.hideResults();
    const status = document.getElementById('uploadStatus');
    const uploadBtn = document.getElementById('uploadBtn');

    status.classList.remove('hidden');
    uploadBtn.disabled = true;
    uploadBtn.textContent = 'Uploading...';
  }

  showSuccess(data) {
    const status = document.getElementById('uploadStatus');
    const result = document.getElementById('uploadResult');
    const uploadBtn = document.getElementById('uploadBtn');

    // Hide uploading status
    status.classList.add('hidden');

    // Show success result
    result.classList.remove('hidden');

    // Populate result data
    document.getElementById('mediaId').textContent = data.mediaId;
    document.getElementById('fileSize').textContent = data.fileSize;
    document.getElementById('chunkCount').textContent = data.chunkCount;

    const retrievedImage = document.getElementById('retrievedImage');
    retrievedImage.src = data.imageUrl;
    retrievedImage.alt = 'Retrieved image';

    // Reset upload button
    uploadBtn.disabled = false;
    uploadBtn.textContent = 'Upload Another Image';

    // Show file integrity comparison
    this.showIntegrityCheck(data.originalFile, data.imageUrl);

    // Show chunk entities information
    if (data.chunkInfo) {
      this.showChunkEntities(data.chunkInfo);
    }
  }

  showError(message) {
    this.hideResults();
    const error = document.getElementById('errorResult');
    const uploadBtn = document.getElementById('uploadBtn');

    error.classList.remove('hidden');
    document.getElementById('errorMessage').textContent = message;

    uploadBtn.disabled = false;
    uploadBtn.textContent = 'Try Again';
  }

  hideResults() {
    const status = document.getElementById('uploadStatus');
    const result = document.getElementById('uploadResult');
    const error = document.getElementById('errorResult');

    status.classList.add('hidden');
    result.classList.add('hidden');
    error.classList.add('hidden');
  }

  async showIntegrityCheck(originalFile, retrievedImageUrl) {
    try {
      // This is a simplified integrity check for demo purposes
      // In practice, the service does full SHA-256 verification
      const originalSize = originalFile.size;

      // Fetch the retrieved image to check size
      const response = await fetch(retrievedImageUrl);
      const retrievedBlob = await response.blob();
      const retrievedSize = retrievedBlob.size;

      const integrityMatch = originalSize === retrievedSize;

      // Add integrity indicator to the result
      const resultDiv = document.getElementById('uploadResult');
      const integrityDiv = document.createElement('div');
      integrityDiv.className = `mt-2 p-2 rounded ${integrityMatch ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`;
      integrityDiv.innerHTML = `
        <div class="flex items-center text-sm">
          <span class="mr-2">${integrityMatch ? '✅' : '❌'}</span>
          <span>Integrity Check: ${integrityMatch ? 'PASSED' : 'FAILED'}</span>
          <span class="ml-2 text-xs">(Original: ${originalSize} bytes, Retrieved: ${retrievedSize} bytes)</span>
        </div>
      `;

      resultDiv.appendChild(integrityDiv);
    } catch (error) {
      console.warn('Could not perform integrity check:', error);
    }
  }

  async getChunkInfo(mediaId) {
    try {
      const response = await fetch(`/chunks/${mediaId}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch chunk info: ${response.statusText}`);
      }
      const data = await response.json();
      return data.chunks;
    } catch (error) {
      console.error('Error fetching chunk info:', error);
      return null;
    }
  }

  showChunkEntities(chunkInfo) {
    const fileInfoDiv = document.getElementById('fileInfo');
    const chunkEntitiesDiv = document.getElementById('chunkEntities');

    if (!fileInfoDiv || !chunkEntitiesDiv || !chunkInfo) return;

    // Show file metadata
    const metadata = chunkInfo.metadata;
    fileInfoDiv.innerHTML = `
      <div class="grid grid-cols-2 gap-2 text-xs">
        <div><strong>Filename:</strong> ${metadata.filename}</div>
        <div><strong>Type:</strong> ${metadata.content_type}</div>
        <div><strong>Size:</strong> ${this.formatFileSize(metadata.file_size)}</div>
        <div><strong>Total Chunks:</strong> ${metadata.total_chunks}</div>
      </div>
    `;

    // Show chunk entities
    chunkEntitiesDiv.innerHTML = '';
    chunkInfo.entities.forEach((chunk, index) => {
      const chunkDiv = document.createElement('div');
      chunkDiv.className = 'flex justify-between items-center text-xs p-2 border rounded bg-gray-50 hover:bg-gray-100';
      chunkDiv.innerHTML = `
        <div class="flex-1">
          <span class="font-mono text-blue-600">Chunk ${chunk.chunk_index}</span>
          <span class="text-gray-500 ml-2">${this.formatFileSize(chunk.size)}</span>
        </div>
        <div class="text-right">
          <div class="font-mono text-xs text-gray-600">${chunk.checksum.substring(0, 8)}...</div>
          <div class="text-xs text-gray-500">Block: ${chunk.expiration_block}</div>
        </div>
      `;
      chunkEntitiesDiv.appendChild(chunkDiv);
    });

    // Add summary at the end
    const summaryDiv = document.createElement('div');
    summaryDiv.className = 'text-xs text-gray-600 p-2 border-t bg-blue-50 mt-2';
    summaryDiv.innerHTML = `
      <div class="flex justify-between">
        <span>Total entities stored: ${chunkInfo.entities.length + 1}</span>
        <span>1 metadata + ${chunkInfo.entities.length} chunks</span>
      </div>
    `;
    chunkEntitiesDiv.appendChild(summaryDiv);
  }

  formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';

    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
}

// Initialize demo when DOM is loaded and ImagesDB is available
document.addEventListener('DOMContentLoaded', () => {
  // Wait for ImageDB to be available
  if (typeof ImageDB !== 'undefined') {
    new ImageDBDemo();
  } else {
    // Retry after a short delay if ImageDB is not yet loaded
    setTimeout(() => {
      if (typeof ImageDB !== 'undefined') {
        new ImageDBDemo();
      } else {
        console.error('ImageDB SDK not loaded');
      }
    }, 100);
  }
});

// Add smooth scrolling for anchor links
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
  anchor.addEventListener('click', function (e) {
    e.preventDefault();
    const target = document.querySelector(this.getAttribute('href'));
    if (target) {
      target.scrollIntoView({
        behavior: 'smooth',
        block: 'start'
      });
    }
  });
});

// Add copy-to-clipboard functionality for code blocks
document.querySelectorAll('pre code').forEach(block => {
  const wrapper = block.closest('pre');
  if (wrapper) {
    const button = document.createElement('button');
    button.className = 'absolute top-2 right-2 bg-gray-700 hover:bg-gray-600 text-white px-2 py-1 rounded text-xs opacity-0 group-hover:opacity-100 transition-opacity';
    button.textContent = 'Copy';

    wrapper.style.position = 'relative';
    wrapper.className += ' group';
    wrapper.appendChild(button);

    button.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(block.textContent);
        button.textContent = 'Copied!';
        setTimeout(() => {
          button.textContent = 'Copy';
        }, 2000);
      } catch (err) {
        console.error('Failed to copy text: ', err);
      }
    });
  }
});