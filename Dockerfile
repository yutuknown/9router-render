FROM decolua/9router:latest

USER root

# Download and install Litestream
ADD https://github.com/benbjohnson/litestream/releases/download/v0.3.13/litestream-v0.3.13-linux-amd64.tar.gz /tmp/litestream.tar.gz
RUN tar -C /usr/local/bin -xzf /tmp/litestream.tar.gz && \
    rm /tmp/litestream.tar.gz

# Copy Litestream configuration, startup script, and model patcher
COPY litestream.yml /etc/litestream.yml
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
COPY patch-models.js /usr/local/bin/patch-models.js

# Ensure scripts are executable
RUN chmod +x /usr/local/bin/entrypoint.sh /usr/local/bin/patch-models.js

# Patch model definitions in /app
RUN node /usr/local/bin/patch-models.js || true

# 9Router stores its db here when DATA_DIR is set to /app/data
ENV DATA_DIR=/app/data

# Create data directory and ensure ownership for standard node/nextjs user (often uid 1000 or 1001). 
# We use 1000 to be safe for Render's non-root environment requirements.
RUN mkdir -p /app/data/db && chown -R 1000:1000 /app /etc/litestream.yml /usr/local/bin/entrypoint.sh /usr/local/bin/patch-models.js

# Switch to non-root user for security (and Render compliance)
USER 1000

# Override the base image's ENTRYPOINT to bypass their su-exec logic
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD []
