# ImagesDB - Image Chunking Middleware for Arkiv

> A middleware service that splits large images into safe-sized chunks, stores them on Arkiv, and serves them back as a single file from the user's point of view.

![ImagesDB Demo](https://img.shields.io/badge/demo-live-brightgreen) ![Docker](https://img.shields.io/badge/docker-ready-blue) ![Arkiv](https://img.shields.io/badge/Arkiv%20DB-integrated-purple)

## 🌟 Features

- **Large File Support**: Upload images up to 25MB
- **Automatic Chunking**: Files split into 64KB chunks that fit Arkiv limits
- **Data Integrity**: SHA-256 checksums ensure perfect file reconstruction
- **Idempotent Uploads**: Resume failed uploads with session management
- **TTL Management**: Configurable expiration (default 7 days)
- **Quota Management**: Built-in rate limiting and storage quotas
- **JavaScript SDK**: Lightweight client library for easy integration
- **Interactive Demo**: Web-based demo with real-time upload/download

## 🚀 Live Demo

Visit **[https://imagedb.online](https://imagedb.online)** to try the interactive demo:
- Upload PNG/JPEG files up to 25MB
- See real-time chunking and integrity verification
- Download the reconstructed files
- Monitor quota usage

## 📚 API Documentation

### Upload Image
```bash
curl -X POST https://imagedb.online/media \
  -F "file=@image.png" \
  -H "Idempotency-Key: unique-key-123"
```

**Response:**
```json
{
  "media_id": "uuid-string",
  "message": "Upload successful"
}
```

### Retrieve Image
```bash
curl https://imagedb.online/media/{media_id} -o retrieved-image.png
```

### Check Quota
```bash
curl https://imagedb.online/quota
```

## 🛠️ Self-Hosted Deployment

### Prerequisites

- Docker & Docker Compose
- Domain with SSL certificate (recommended)
- Nginx Proxy Manager or similar reverse proxy

### Quick Start

1. **Clone the repository**
   ```bash
   git clone https://github.com/m00npl/imagedb.git
   cd imagedb
   ```

2. **Configure environment**
   ```bash
   cp .env.example .env
   # Edit .env with your Arkiv settings
   ```

3. **Start with Docker Compose**
   ```bash
   docker compose up -d
   ```

4. **Access the service**
   - Local: `http://localhost:3000`
   - Configure your reverse proxy to point to port 3000

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `NODE_ENV` | Environment mode | `production` |
| `PORT` | Server port | `3000` |
| `ARKIV_RPC_URL` | Arkiv RPC endpoint | `https://kaolin.hoodi.arkiv.network/rpc` |
| `ARKIV_CHAIN_ID` | Arkiv chain ID | `60138453025` |

### Docker Compose Configuration

```yaml
version: '3.8'

services:
  imagedb:
    image: moonplkr/imagesdb:latest
    container_name: imagedb
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - PORT=3000
      - ARKIV_RPC_URL=https://kaolin.hoodi.arkiv.network/rpc
      - ARKIV_CHAIN_ID=60138453025
    volumes:
      - ./data:/usr/src/app/data
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
```

### Production Deployment with Nginx

1. **Install Nginx Proxy Manager**
   ```bash
   docker run -d \
     --name nginx-proxy-manager \
     -p 80:80 -p 443:443 -p 81:81 \
     -v npm_data:/data \
     -v npm_letsencrypt:/etc/letsencrypt \
     jc21/nginx-proxy-manager:latest
   ```

2. **Configure Proxy Host**
   - Domain: `your-domain.com`
   - Forward to: `imagedb:3000`
   - Enable SSL with Let's Encrypt

3. **Update Docker Compose**
   ```yaml
   services:
     imagedb:
       # Remove ports mapping for security
       # ports:
       #   - "3000:3000"
       networks:
         - nginx_network

   networks:
     nginx_network:
       external: true
   ```

## 🔧 Development

### Local Development

1. **Install dependencies**
   ```bash
   bun install
   ```

2. **Start development server**
   ```bash
   bun run dev
   ```

3. **Run tests**
   ```bash
   bun test
   ```

### Building

```bash
# Build the application
bun run build

# Build Docker image
docker buildx build -t your-registry/imagedb:latest .
```

## 📦 JavaScript SDK

Download the SDK from your deployment:
```bash
curl -O https://your-domain.com/sdk/imagesdb-sdk.js
```

### Usage Example

```javascript
import ImagesDB from './imagesdb-sdk.js';

const client = new ImagesDB('https://your-domain.com');

// Upload image
const result = await client.upload(file, {
  idempotencyKey: 'unique-key',
  ttlDays: 30
});

console.log('Media ID:', result.media_id);

// Retrieve image
const imageBlob = await client.get(result.media_id);
const imageUrl = URL.createObjectURL(imageBlob);
```

## 🏗️ Architecture

### Components

- **Upload Service**: Handles file uploads and chunking
- **Arkiv Storage**: Manages chunk storage on Arkiv
- **Quota Service**: Enforces usage limits
- **Chunking Service**: Splits/reassembles files with integrity checks

### Data Flow

1. **Upload**: File → Chunks (64KB) → Arkiv entities
2. **Storage**: Each chunk stored with metadata and expiration
3. **Retrieval**: Fetch chunks → Verify integrity → Reassemble file
4. **Cleanup**: Expired chunks automatically pruned

## 🔒 Security Features

- **Input Validation**: File type and size restrictions
- **Checksum Verification**: SHA-256 integrity checks
- **Quota Enforcement**: Rate limiting and storage limits
- **TTL Management**: Automatic data expiration
- **CORS Protection**: Configurable cross-origin policies

## 📋 API Reference

### Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/media` | Upload image file |
| `GET` | `/media/{id}` | Retrieve image |
| `GET` | `/quota` | Check quota usage |
| `GET` | `/status/{key}` | Upload status |
| `GET` | `/health` | Health check |

### Rate Limits (Free Tier)

- **Storage**: 100MB total
- **Uploads**: 10 per day
- **File Size**: 25MB maximum
- **TTL**: 7 days default

## 🐛 Troubleshooting

### Common Issues

1. **502 Bad Gateway**
   - Check if containers are on the same Docker network
   - Verify port configuration in proxy

2. **Upload Fails**
   - Check file size limits (25MB max)
   - Verify file type (PNG/JPEG only)
   - Check quota limits

3. **Chunks Missing**
   - Verify Arkiv connectivity
   - Check TTL expiration
   - Validate network stability during upload

### Logs

```bash
# View container logs
docker logs imagedb

# Follow logs in real-time
docker logs -f imagedb
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details.

## 🙋 Support

- **Issues**: [GitHub Issues](https://github.com/m00npl/imagedb/issues)
- **Email**: [maciej.maciejowski@arkiv.network](mailto:maciej.maciejowski@arkiv.network)
- **Demo**: [https://imagedb.online](https://imagedb.online)

---

Built with ❤️ for the Arkiv ecosystem