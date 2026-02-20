#!/bin/bash
count=${1:-1}
for _ in $(seq 1 "$count"); do
  cat /proc/sys/kernel/random/uuid
done
