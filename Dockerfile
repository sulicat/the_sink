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

# Copy web files
COPY www/ /var/www/html/

# Create data directory
RUN mkdir -p /var/data && chmod 777 /var/data

# Copy startup script
COPY start.sh /start.sh
RUN chmod +x /start.sh

EXPOSE 80

CMD ["/start.sh"]
