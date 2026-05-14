FROM node:20-slim

# Install system dependencies for node-canvas, bcrypt, etc. if needed
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY middleware/package*.json ./

# Install dependencies
RUN npm ci --omit=dev

COPY middleware/requirements.txt /tmp/requirements.txt
RUN pip3 install --no-cache-dir --break-system-packages -r /tmp/requirements.txt

# Copy the rest of the application
COPY middleware/ ./
COPY mapper.py /mapper.py

# Expose the middleware port
EXPOSE 4000

# Set environment defaults
ENV PORT=4000
ENV NODE_ENV=production

HEALTHCHECK --interval=15s --timeout=5s --start-period=45s --retries=3 \
    CMD node -e "require('http').get('http://127.0.0.1:4000/api/health', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

# Run the middleware
CMD ["node", "middleware.js"]
