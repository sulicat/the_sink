#!/bin/bash
mkdir -p /var/data
chmod 777 /var/data
mkdir -p /var/www/html/models /var/www/html/skyboxes /var/www/html/textures
chmod 777 /var/www/html/models /var/www/html/skyboxes /var/www/html/textures
service php8.1-fpm start
nginx -g 'daemon off;'
