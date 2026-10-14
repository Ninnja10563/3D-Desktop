#!/usr/bin/env python3
"""Sample the selected proof PID; this does not measure WindowServer GPU work or input latency."""
import argparse
import json
import subprocess
import time

parser = argparse.ArgumentParser()
parser.add_argument("pid", type=int)
parser.add_argument("--seconds", type=float, default=30)
args = parser.parse_args()
if args.pid <= 0 or not 1 <= args.seconds <= 180:
    parser.error("Use a positive PID and a duration from 1 through 180 seconds.")
deadline = time.monotonic() + args.seconds
samples = []
while time.monotonic() < deadline:
    result = subprocess.run(["ps", "-p", str(args.pid), "-o", "%cpu=,rss="], capture_output=True, text=True, check=False)
    values = result.stdout.split()
    if len(values) != 2:
        break
    samples.append({"elapsed_seconds": args.seconds - max(0, deadline - time.monotonic()),
                    "cpu_percent": float(values[0]), "rss_mib": int(values[1]) / 1024})
    time.sleep(0.5)
print(json.dumps({"pid": args.pid, "method": "ps %cpu (OS rolling estimate) and RSS; 0.5 s sampling",
                  "samples": samples,
                  "mean_cpu_percent": sum(s["cpu_percent"] for s in samples) / max(1, len(samples)),
                  "peak_rss_mib": max((s["rss_mib"] for s in samples), default=0)}, indent=2))
