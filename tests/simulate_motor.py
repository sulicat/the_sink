#!/usr/bin/env python3
"""
Simulates a motor with realistic position, speed, and temperature data.
Sends at 10 Hz until Ctrl+C.

Labels: motor_position (rad), motor_speed (rpm), motor_temp (C)

Usage:
    python3 simulate_motor.py
    python3 simulate_motor.py --rpm 60
    SINK_HOST=http://192.168.1.10 python3 simulate_motor.py
"""

import math
import time
import random
import urllib.request
import urllib.error
import json
import os
import argparse

HOST = os.environ.get("SINK_HOST", "http://localhost")
INTERVAL = 0.1


def send(label, value, timestamp):
    payload = json.dumps({"label": label, "value": value, "timestamp": timestamp}).encode()
    req = urllib.request.Request(
        f"{HOST}/api/ingest.php",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=1):
            pass
    except urllib.error.URLError as e:
        print(f"\n  [warn] {e}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--rpm", type=float, default=30.0, help="Motor speed in RPM")
    args = parser.parse_args()

    rpm = args.rpm
    rads_per_sec = rpm * 2 * math.pi / 60

    print(f"Simulating motor at {rpm} RPM → {HOST}")
    print("Labels: motor_position (rad 0-2π), motor_speed (rpm), motor_temp (C)")
    print("Ctrl+C to stop\n")

    start = time.time()
    base_temp = 40.0

    while True:
        t = time.time()
        elapsed = t - start
        ts = int(t)

        # Position wraps 0 → 2π
        position = (elapsed * rads_per_sec) % (2 * math.pi)

        # Speed with small noise
        speed = rpm + random.gauss(0, 0.5)

        # Temperature rises slowly then plateaus with noise
        temp = base_temp + min(elapsed * 0.2, 15) + random.gauss(0, 0.3)

        send("motor_position", round(position, 5), ts)
        send("motor_speed", round(speed, 2), ts)
        send("motor_temp", round(temp, 2), ts)

        print(
            f"\r{elapsed:6.1f}s  pos={position:.3f} rad  "
            f"speed={speed:.1f} rpm  temp={temp:.1f} C",
            end="",
            flush=True,
        )

        time.sleep(INTERVAL)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nDone.")
