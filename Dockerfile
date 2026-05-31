# The official Playwright image bundles Chromium, its system dependencies, and
# Node.js. The tag is pinned to the same version as the `playwright` npm package
# so the prebuilt browser is found at runtime (web-page rendering relies on it).
FROM mcr.microsoft.com/playwright:v1.59.1-noble

WORKDIR /app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000

# Install dependencies first so this layer is cached unless the lockfile changes.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy the rest of the application source.
COPY . .

# Run as the non-root user that ships with the Playwright image, and make the
# app directory (including runtime data folders) writable by it.
RUN chown -R pwuser:pwuser /app
USER pwuser

EXPOSE 3000

CMD ["node", "server.js"]
