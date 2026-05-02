#!/usr/bin/env python3
"""
Simulates orbital positions for the solar_system scene.
Sends planet X/Z positions at 10 Hz so you can bind them in the UI.

Labels: planet1_x, planet1_z, planet2_x, planet2_z, planet3_x, planet3_z

Usage:
    python3 simulate_solar.py
    SINK_HOST=http://192.168.1.10 python3 simulate_solar.py
"""

import math
import time
import urllib.request
import urllib.error
import json
import os

HOST = os.environ.get("SINK_HOST", "http://localhost")
INTERVAL = 0.1  # seconds

# (orbital_radius, angular_speed_rad_per_sec)
PLANETS = {
    "planet1": (5.0, 0.4),
    "planet2": (9.0, 0.2),
    "planet3": (14.0, 0.1),
}


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
    print(f"Simulating solar system orbits → {HOST}")
    print("Labels: planet1_x/z  planet2_x/z  planet3_x/z")
    print("Ctrl+C to stop\n")

    start = time.time()
    while True:
        t = time.time()
        elapsed = t - start
        ts = int(t)

        for name, (radius, speed) in PLANETS.items():
            angle = elapsed * speed
            x = radius * math.cos(angle)
            z = radius * math.sin(angle)
            send(f"{name}_x", round(x, 4), ts)
            send(f"{name}_z", round(z, 4), ts)

        values = {
            name: (
                round(r * math.cos(elapsed * s), 2),
                round(r * math.sin(elapsed * s), 2),
            )
            for name, (r, s) in PLANETS.items()
        }
        status = "  ".join(f"{n} ({x:5.1f},{z:5.1f})" for n, (x, z) in values.items())
        print(f"\r{elapsed:6.1f}s  {status}", end="", flush=True)

        time.sleep(INTERVAL)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nDone.")
