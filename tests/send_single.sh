#!/bin/bash
# Send a single data point
# Usage: ./send_single.sh <label> <value>
# Example: ./send_single.sh motor_position 1.57

HOST="${SINK_HOST:-http://localhost}"
LABEL="${1:-test_value}"
VALUE="${2:-0}"

curl -s -X POST "$HOST/api/ingest.php" \
  -H "Content-Type: application/json" \
  -d "{\"label\": \"$LABEL\", \"value\": $VALUE}" | jq .
