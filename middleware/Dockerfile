FROM node:20-slim

# Install system dependencies for node-canvas, bcrypt, etc. if needed
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --production

# Copy the rest of the application
COPY . .

# Expose the middleware port
EXPOSE 4000

# Set environment defaults
ENV PORT=4000
ENV NODE_ENV=production

# Run the middleware
CMD ["node", "middleware.js"]
