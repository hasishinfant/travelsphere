"""Evaluation metrics, reported exactly as computed."""
from __future__ import annotations

import numpy as np
from sklearn.metrics import (average_precision_score, brier_score_loss, confusion_matrix, f1_score,
                             precision_score, recall_score, roc_auc_score)


def evaluate(y: np.ndarray, score: np.ndarray, threshold: float, y_red: np.ndarray | None = None) -> dict:
    pred = (score >= threshold).astype(int)
    tn, fp, fn, tp = confusion_matrix(y, pred, labels=[0, 1]).ravel()
    out = {
        "n": int(len(y)), "positives": int(y.sum()), "threshold": round(float(threshold), 4),
        "precision": round(float(precision_score(y, pred, zero_division=0)), 4),
        "recall": round(float(recall_score(y, pred, zero_division=0)), 4),
        "f1": round(float(f1_score(y, pred, zero_division=0)), 4),
        "false_positive_rate": round(float(fp / (fp + tn)) if (fp + tn) else 0.0, 4),
        "confusion_matrix": {"tn": int(tn), "fp": int(fp), "fn": int(fn), "tp": int(tp)},
        "pr_auc": round(float(average_precision_score(y, score)), 4) if y.sum() else None,
        "roc_auc": round(float(roc_auc_score(y, score)), 4) if 0 < y.sum() < len(y) else None,
        "brier": round(float(brier_score_loss(y, np.clip(score, 0, 1))), 5),
        "prevalence": round(float(y.mean()), 5),
    }
    if y_red is not None and y_red.sum():
        out["high_risk_recall"] = round(float(pred[y_red == 1].mean()), 4)
        out["high_risk_positives"] = int(y_red.sum())
    return out


def best_f1_threshold(y: np.ndarray, score: np.ndarray) -> float:
    """Threshold chosen on the VALIDATION set only (never on test)."""
    candidates = np.unique(np.quantile(score, np.linspace(0.5, 0.9995, 400)))
    best, best_t = -1.0, 0.5
    for t in candidates:
        f = f1_score(y, (score >= t).astype(int), zero_division=0)
        if f > best:
            best, best_t = f, float(t)
    return best_t
