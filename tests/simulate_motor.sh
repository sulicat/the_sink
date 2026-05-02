#!/bin/bash
# Simulates a spinning motor with position (radians) and speed (rpm)
# Sends data at ~10 Hz until Ctrl+C

HOST="${SINK_HOST:-http://localhost}"
INTERVAL=0.1  # seconds between samples
SPEED_RPM=30  # simulated motor speed

echo "Simulating motor at ${SPEED_RPM} RPM — Ctrl+C to stop"
echo "Labels: motor_position (rad), motor_speed (rpm), motor_temp (C)"
echo ""

angle=0
start=$(date +%s%N)

while true; do
    now=$(date +%s%N)
    elapsed=$(echo "scale=3; ($now - $start) / 1000000000" | bc)

    # Angle wraps 0 → 2π based on RPM
    angle=$(echo "scale=6; $elapsed * $SPEED_RPM * 6.28318 / 60" | bc)
    # Wrap to 0–2π
    angle=$(echo "scale=6; $angle - (($angle / 6.28318) | 0) * 6.28318" | bc 2>/dev/null || echo "$angle")

    # Add a bit of noise to speed and temperature
    noise=$(echo "scale=3; $(( RANDOM % 100 - 50 )) / 100" | bc)
    speed=$(echo "scale=2; $SPEED_RPM + $noise * 2" | bc)
    temp=$(echo "scale=2; 45 + $noise * 3" | bc)

    ts=$(date +%s)

    curl -s -X POST "$HOST/api/ingest.php" \
      -H "Content-Type: application/json" \
      -d "{\"label\":\"motor_position\",\"value\":$angle,\"timestamp\":$ts}" > /dev/null &

    curl -s -X POST "$HOST/api/ingest.php" \
      -H "Content-Type: application/json" \
      -d "{\"label\":\"motor_speed\",\"value\":$speed,\"timestamp\":$ts}" > /dev/null &

    curl -s -X POST "$HOST/api/ingest.php" \
      -H "Content-Type: application/json" \
      -d "{\"label\":\"motor_temp\",\"value\":$temp,\"timestamp\":$ts}" > /dev/null &

    printf "\rangle=%.3f rad  speed=%.1f rpm  temp=%.1f C  t=%.1fs" \
      "$angle" "$speed" "$temp" "$elapsed"

    sleep "$INTERVAL"
done
