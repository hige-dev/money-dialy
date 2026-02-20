#!/bin/bash
count=${1:-1}
for _ in $(seq 1 "$count"); do
  printf '#%02X%02X%02X\n' $((RANDOM % 200 + 40)) $((RANDOM % 200 + 40)) $((RANDOM % 200 + 40))
done
