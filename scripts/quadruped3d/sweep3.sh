#!/bin/bash
# Fiabilité de « Repartir de zéro » : cerveaux aléatoires 1001…1006 (comme le navigateur), σ donné.
# Usage : scripts/quadruped3d/sweep3.sh 0.06 0.08
cd /home/user/rl-playground
for sigma in "$@"; do
  for b in 1001 1002 1003 1004 1005 1006; do
    out=$(timeout 400 npx --yes tsx scripts/quadruped3d/train.ts --name exp --gens 121 --threads 3 --dry --seed 1 --brainseed $b --sigma $sigma 2>&1 | grep -E "^gen (0|30|60|90|120) " | awk '{printf "%s:%s%s(%s) ", $2, $6, ($10=="true"?"F":""), $16}')
    echo "sigma $sigma brain $b -> $out"
  done
done
