# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy>=1.26", "scipy>=1.13"]
# ///
"""
How many questions and repetitions does the study need? Monte Carlo power of the paired Wilcoxon test on log(cost).

    uv run bench/analysis/power.py                               uses bench/results/_analysis/variance.json (pilot)
    uv run bench/analysis/power.py --between 0.45 --within 0.25  or give the spreads by hand

Model: for question i, the true log ratio (index / no index) is mu + b_i, with b_i ~ N(0, between); each repetition
of each configuration adds noise e ~ N(0, within). The test runs on the mean over repetitions.
Prints the power for each number of questions × repetitions × true effect (ratio 0.70 to 0.95).
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from scipy import stats

import os
ROOT = Path(os.environ["BENCH_DATA"]).resolve() if os.environ.get("BENCH_DATA") else Path(__file__).resolve().parents[2] / "bench-data"
VAR = ROOT / "results" / "_analysis" / "variance.json"


def power(n: int, reps: int, ratio: float, between: float, within: float, sims: int, rng: np.random.Generator) -> float:
    hits = 0
    for _ in range(sims):
        true = np.log(ratio) + rng.normal(0, between, n)
        # difference of two means of `reps` noisy runs each
        noise = rng.normal(0, within, (n, reps)).mean(axis=1) - rng.normal(0, within, (n, reps)).mean(axis=1)
        d = true + noise
        if stats.wilcoxon(d).pvalue < 0.05:
            hits += 1
    return hits / sims


def main() -> None:
    import sys
    sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser()
    parser.add_argument("--between", type=float, help="sd of the per-question log ratio")
    parser.add_argument("--within", type=float, help="sd of log(cost) between repetitions of the same run")
    parser.add_argument("--sims", type=int, default=1000)
    args = parser.parse_args()
    known = json.loads(VAR.read_text()) if VAR.exists() else {}
    # defaults from the October 2026 measurements (3 repetitions, 6 questions) when the pilot has too few units
    between = args.between or known.get("between_unit_log_ratio_sd") or 0.35
    within = args.within or known.get("within_unit_log_sd") or 0.25
    print(f"sd between questions = {between:.2f}, sd between repetitions = {within:.2f} (log scale)\n")
    rng = np.random.default_rng(1)
    ratios = [0.70, 0.80, 0.90, 0.95]
    print("questions  reps  " + "  ".join(f"ratio {r:.2f}" for r in ratios))
    for n in [10, 20, 30, 50, 80, 120, 150, 200]:
        for reps in [1, 3, 5]:
            row = [power(n, reps, r, between, within, args.sims, rng) for r in ratios]
            print(f"{n:>9}  {reps:>4}  " + "  ".join(f"{p:>10.0%}" for p in row))
    print("\nRead: the smallest number of questions with power >= 80% for the effect you expect. Per agent, per comparison.")


if __name__ == "__main__":
    main()
