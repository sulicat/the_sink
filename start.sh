#!/bin/bash
mkdir -p /var/data
chmod 777 /var/data
service php8.1-fpm start
nginx -g 'daemon off;'
