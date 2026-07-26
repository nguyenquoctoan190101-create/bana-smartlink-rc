#!/usr/bin/env python
"""Evaluate OCR field extraction on a registered, de-identified holdout set.

Ground-truth JSONL rows:
  {"document_id":"d-001","split":"holdout","source_type":"printed_scan",
   "fields":{"CT01":12}}

Prediction JSONL rows:
  {"document_id":"d-001","fields":{"CT01":{"value":12,"confidence":0.99,
   "requires_review":false}}}

The evaluator performs exact JSON-value comparison. It deliberately does not
repair, coerce or normalize predictions because doing so would inflate the
reported extraction result.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from collections import defaultdict
from pathlib import Path
from typing import Any


ALLOWED_SPLITS = {"development", "validation", "holdout"}
REQUIRED_SOURCE_TYPES = {"excel", "printed_scan", "handwritten"}
SOURCE_ACCURACY_TARGETS = {
    "excel": 0.99,
    "printed_scan": 0.95,
    "handwritten": 0.85,
}


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for line_number, raw_line in enumerate(
        path.read_text(encoding="utf-8").splitlines(), start=1
    ):
        if not raw_line.strip():
            continue
        try:
            row = json.loads(raw_line)
        except json.JSONDecodeError as exc:
            raise ValueError(f"{path.name}:{line_number}: invalid JSON") from exc
        if not isinstance(row, dict):
            raise ValueError(f"{path.name}:{line_number}: row must be an object")
        rows.append(row)
    return rows


def validate_ground_truth(
    rows: list[dict[str, Any]],
    *,
    minimum_documents: int = 100,
    minimum_holdout_ratio: float = 0.20,
) -> list[str]:
    errors: list[str] = []
    identifiers: set[str] = set()
    holdout_counts: dict[str, int] = defaultdict(int)
    if len(rows) < minimum_documents:
        errors.append(
            f"dataset has {len(rows)} documents; at least {minimum_documents} are required"
        )
    for index, row in enumerate(rows, start=1):
        identifier = row.get("document_id")
        if not isinstance(identifier, str) or not identifier.strip():
            errors.append(f"row {index}: document_id is required")
        elif identifier in identifiers:
            errors.append(f"row {index}: duplicate document_id")
        else:
            identifiers.add(identifier)
        split = row.get("split")
        if split not in ALLOWED_SPLITS:
            errors.append(f"row {index}: unsupported split")
        source_type = row.get("source_type")
        if source_type not in REQUIRED_SOURCE_TYPES:
            errors.append(f"row {index}: unsupported source_type")
        fields = row.get("fields")
        if not isinstance(fields, dict) or not fields:
            errors.append(f"row {index}: fields must be a non-empty object")
        if split == "holdout" and source_type in REQUIRED_SOURCE_TYPES:
            holdout_counts[str(source_type)] += 1
    holdout_total = sum(holdout_counts.values())
    minimum_holdout = max(20, int(len(rows) * minimum_holdout_ratio + 0.999999))
    if holdout_total < minimum_holdout:
        errors.append(
            f"holdout has {holdout_total} documents; at least {minimum_holdout} are required"
        )
    for source_type in sorted(REQUIRED_SOURCE_TYPES):
        if holdout_counts[source_type] < 3:
            errors.append(
                f"holdout source_type {source_type!r} has fewer than 3 documents"
            )
    return errors


def _prediction_index(
    rows: list[dict[str, Any]],
) -> tuple[dict[str, dict[str, Any]], list[str]]:
    predictions: dict[str, dict[str, Any]] = {}
    errors: list[str] = []
    for index, row in enumerate(rows, start=1):
        identifier = row.get("document_id")
        if not isinstance(identifier, str) or not identifier:
            errors.append(f"prediction row {index}: document_id is required")
            continue
        if identifier in predictions:
            errors.append(f"prediction row {index}: duplicate document_id")
            continue
        fields = row.get("fields")
        if not isinstance(fields, dict):
            errors.append(f"prediction row {index}: fields must be an object")
            continue
        predictions[identifier] = fields
    return predictions, errors


def evaluate_holdout(
    ground_truth: list[dict[str, Any]],
    prediction_rows: list[dict[str, Any]],
) -> dict[str, Any]:
    predictions, contract_errors = _prediction_index(prediction_rows)
    by_source: dict[str, dict[str, int]] = defaultdict(
        lambda: {"correct": 0, "total": 0, "documents": 0}
    )
    total_fields = 0
    correct_fields = 0
    incorrect_fields = 0
    reviewed_errors = 0
    false_accepts = 0
    missing_documents: list[str] = []
    exact_documents = 0
    holdout_documents = [
        row for row in ground_truth if row.get("split") == "holdout"
    ]
    for document in holdout_documents:
        document_id = str(document["document_id"])
        source_type = str(document["source_type"])
        truth_fields = document["fields"]
        predicted_fields = predictions.get(document_id)
        by_source[source_type]["documents"] += 1
        document_exact = predicted_fields is not None
        if predicted_fields is None:
            missing_documents.append(document_id)
            predicted_fields = {}
        for field_name, truth_value in truth_fields.items():
            total_fields += 1
            by_source[source_type]["total"] += 1
            prediction = predicted_fields.get(field_name)
            if not isinstance(prediction, dict):
                prediction = {}
                contract_errors.append(
                    f"{document_id}.{field_name}: prediction must be an object"
                )
            confidence = prediction.get("confidence")
            if not isinstance(confidence, (int, float)) or isinstance(confidence, bool):
                contract_errors.append(
                    f"{document_id}.{field_name}: confidence must be numeric"
                )
            elif not 0 <= float(confidence) <= 1:
                contract_errors.append(
                    f"{document_id}.{field_name}: confidence must be between 0 and 1"
                )
            requires_review = prediction.get("requires_review")
            if not isinstance(requires_review, bool):
                contract_errors.append(
                    f"{document_id}.{field_name}: requires_review must be boolean"
                )
                requires_review = False
            is_exact = "value" in prediction and prediction["value"] == truth_value
            if is_exact:
                correct_fields += 1
                by_source[source_type]["correct"] += 1
            else:
                document_exact = False
                incorrect_fields += 1
                if requires_review:
                    reviewed_errors += 1
                else:
                    false_accepts += 1
        if document_exact:
            exact_documents += 1
    source_results: dict[str, Any] = {}
    gate_failures = sorted(set(contract_errors))
    for source_type in sorted(REQUIRED_SOURCE_TYPES):
        counts = by_source[source_type]
        accuracy = (
            counts["correct"] / counts["total"] if counts["total"] else None
        )
        target = SOURCE_ACCURACY_TARGETS[source_type]
        passed = accuracy is not None and accuracy >= target
        if not passed:
            gate_failures.append(
                f"{source_type} field accuracy did not meet target {target:.0%}"
            )
        source_results[source_type] = {
            **counts,
            "field_accuracy": accuracy,
            "target": target,
            "passed": passed,
        }
    if missing_documents:
        gate_failures.append("one or more holdout documents have no prediction")
    if false_accepts:
        gate_failures.append("one or more incorrect fields were not marked for review")
    return {
        "status": "passed" if not gate_failures else "failed",
        "holdout": {
            "documents": len(holdout_documents),
            "exact_documents": exact_documents,
            "document_exact_match": (
                exact_documents / len(holdout_documents)
                if holdout_documents
                else None
            ),
            "fields": total_fields,
            "correct_fields": correct_fields,
            "field_exact_match": (
                correct_fields / total_fields if total_fields else None
            ),
            "incorrect_fields": incorrect_fields,
            "errors_marked_for_review": reviewed_errors,
            "false_accepts": false_accepts,
            "review_recall_on_errors": (
                reviewed_errors / incorrect_fields if incorrect_fields else 1.0
            ),
            "missing_prediction_documents": sorted(missing_documents),
        },
        "by_source_type": source_results,
        "gate_failures": sorted(set(gate_failures)),
    }


def file_sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ground-truth", required=True, type=Path)
    parser.add_argument("--predictions", required=True, type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args(argv)
    try:
        truth = read_jsonl(args.ground_truth)
        predictions = read_jsonl(args.predictions)
    except (OSError, ValueError) as exc:
        print(f"[FAIL] OCR benchmark input: {exc}")
        return 1
    dataset_errors = validate_ground_truth(truth)
    if dataset_errors:
        for error in dataset_errors:
            print(f"[FAIL] {error}")
        return 1
    result = evaluate_holdout(truth, predictions)
    result["evidence"] = {
        "ground_truth_sha256": file_sha256(args.ground_truth),
        "predictions_sha256": file_sha256(args.predictions),
        "comparison": "exact JSON value; no evaluator coercion or normalization",
    }
    rendered = json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered, encoding="utf-8")
    else:
        print(rendered, end="")
    return 0 if result["status"] == "passed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
