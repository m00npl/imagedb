/**
 * ImageDB JavaScript SDK
 * Lightweight client for the ImageDB image chunking service
 *
 * @version 1.0.0
 * @author ImageDB Team
 */

class ImageDB {
  /**
   * Create a new ImageDB client
   * @param {string} baseUrl - The base URL of the ImageDB service
   */
  constructor(baseUrl = 'http://localhost:3000') {
    this.baseUrl = baseUrl.replace(/\/$/, ''); // Remove trailing slash
  }

  /**
   * Upload an image file
   * @param {File|Blob} file - The image file to upload
   * @param {Object} options - Upload options
   * @param {string} options.idempotencyKey - Unique key for upload session
   * @param {number} options.ttlDays - Time to live in days (default: 7)
   * @param {string} options.userId - User ID for quota tracking
   * @returns {Promise<Object>} Upload result with media_id
   */
  async upload(file, options = {}) {
    if (!file) {
      throw new Error('File is required');
    }

    if (file.size > 25 * 1024 * 1024) {
      throw new Error('File size exceeds 25MB limit');
    }

    const formData = new FormData();
    formData.append('file', file);

    const headers = {};

    if (options.idempotencyKey) {
      headers['Idempotency-Key'] = options.idempotencyKey;
    }

    if (options.ttlDays) {
      headers['BTL-Days'] = options.ttlDays.toString();
    }

    if (options.userId) {
      headers['X-User-Id'] = options.userId;
    }

    const response = await fetch(`${this.baseUrl}/media`, {
      method: 'POST',
      body: formData,
      headers
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Upload failed: ${response.status} ${error}`);
    }

    return await response.json();
  }

  /**
   * Retrieve an image by media ID
   * @param {string} mediaId - The media ID returned from upload
   * @param {Object} options - Retrieval options
   * @param {boolean} options.asBlob - Return as Blob instead of Response (default: true)
   * @returns {Promise<Blob|Response>} The image data
   */
  async get(mediaId, options = { asBlob: true }) {
    if (!mediaId) {
      throw new Error('Media ID is required');
    }

    const response = await fetch(`${this.baseUrl}/media/${mediaId}`);

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Retrieval failed: ${response.status} ${error}`);
    }

    return options.asBlob ? await response.blob() : response;
  }

  /**
   * Get quota information
   * @param {string} userId - User ID for quota tracking
   * @returns {Promise<Object>} Quota information
   */
  async getQuota(userId = null) {
    const headers = {};
    if (userId) {
      headers['X-User-Id'] = userId;
    }

    const response = await fetch(`${this.baseUrl}/quota`, { headers });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Quota check failed: ${response.status} ${error}`);
    }

    return await response.json();
  }

  /**
   * Check upload status by idempotency key
   * @param {string} idempotencyKey - The idempotency key used during upload
   * @returns {Promise<Object>} Upload status information
   */
  async getStatus(idempotencyKey) {
    if (!idempotencyKey) {
      throw new Error('Idempotency key is required');
    }

    const response = await fetch(`${this.baseUrl}/status/${idempotencyKey}`);

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Status check failed: ${response.status} ${error}`);
    }

    return await response.json();
  }

  /**
   * Check if the service is healthy
   * @returns {Promise<Object>} Health status
   */
  async health() {
    const response = await fetch(`${this.baseUrl}/health`);

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Health check failed: ${response.status} ${error}`);
    }

    return await response.json();
  }

  /**
   * Utility method to create an object URL from a media ID
   * @param {string} mediaId - The media ID
   * @returns {Promise<string>} Object URL for the image
   */
  async createObjectURL(mediaId) {
    const blob = await this.get(mediaId);
    return URL.createObjectURL(blob);
  }

  /**
   * Utility method to download an image as a file
   * @param {string} mediaId - The media ID
   * @param {string} filename - The filename to save as
   */
  async download(mediaId, filename = 'image') {
    const response = await this.get(mediaId, { asBlob: false });
    const blob = await response.blob();

    // Try to get filename from response headers
    const contentDisposition = response.headers.get('content-disposition');
    if (contentDisposition && !filename.includes('.')) {
      const match = contentDisposition.match(/filename="([^"]+)"/);
      if (match) {
        filename = match[1];
      }
    }

    // Create download link
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /**
   * Generate a unique idempotency key
   * @returns {string} Unique key
   */
  static generateIdempotencyKey() {
    return `upload-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Validate file before upload
   * @param {File} file - The file to validate
   * @returns {Object} Validation result
   */
  static validateFile(file) {
    const errors = [];

    if (!file) {
      errors.push('No file provided');
      return { valid: false, errors };
    }

    if (file.size > 25 * 1024 * 1024) {
      errors.push('File size exceeds 25MB limit');
    }

    if (!['image/png', 'image/jpeg'].includes(file.type)) {
      errors.push('Only PNG and JPEG files are supported');
    }

    return {
      valid: errors.length === 0,
      errors,
      size: file.size,
      type: file.type,
      name: file.name
    };
  }
}

// Export for both ES modules and CommonJS
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ImageDB;
}

// Make ImageDB available globally in browser
if (typeof window !== 'undefined') {
  window.ImageDB = ImageDB;
}