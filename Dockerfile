FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y \
    nginx \
    php8.1-fpm \
    php8.1-sqlite3 \
    sqlite3 \
    && rm -rf /var/lib/apt/lists/*

# Copy nginx config
COPY nginx/default.conf /etc/nginx/sites-available/default

# PHP upload limits
COPY php/uploads.ini /etc/php/8.1/fpm/conf.d/99-uploads.ini

# Copy web files
COPY www/ /var/www/html/

# Create data directory and upload directories
RUN mkdir -p /var/data && chmod 777 /var/data && \
    mkdir -p /var/www/html/models /var/www/html/skyboxes /var/www/html/textures && \
    chmod 777 /var/www/html/models /var/www/html/skyboxes /var/www/html/textures

# Copy startup script
COPY start.sh /start.sh
RUN chmod +x /start.sh

EXPOSE 80

CMD ["/start.sh"]
