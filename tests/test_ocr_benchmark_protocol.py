from __future__ import annotations

from scripts import ocr_benchmark


def _registered_dataset() -> list[dict[str, object]]:
    source_types = ("excel", "printed_scan", "handwritten")
    rows: list[dict[str, object]] = []
    for index in range(100):
        rows.append(
            {
                "document_id": f"document-{index:03d}",
                "split": "holdout" if index < 20 else "development",
                "source_type": source_types[index % len(source_types)],
                "fields": {"CT01": index},
            }
        )
    return rows


def _exact_predictions(
    ground_truth: list[dict[str, object]],
) -> list[dict[str, object]]:
    return [
        {
            "document_id": row["document_id"],
            "fields": {
                "CT01": {
                    "value": row["fields"]["CT01"],  # type: ignore[index]
                    "confidence": 0.99,
                    "requires_review": False,
                }
            },
        }
        for row in ground_truth
        if row["split"] == "holdout"
    ]


def test_registered_dataset_requires_100_documents_and_a_stratified_holdout() -> None:
    dataset = _registered_dataset()

    assert ocr_benchmark.validate_ground_truth(dataset) == []
    assert any(
        "at least 100" in error
        for error in ocr_benchmark.validate_ground_truth(dataset[:99])
    )
    for row in dataset:
        if row["source_type"] == "handwritten" and row["split"] == "holdout":
            row["split"] = "development"
    assert any(
        "handwritten" in error
        for error in ocr_benchmark.validate_ground_truth(dataset)
    )


def test_holdout_metrics_do_not_hide_an_unreviewed_error() -> None:
    dataset = _registered_dataset()
    predictions = _exact_predictions(dataset)

    passed = ocr_benchmark.evaluate_holdout(dataset, predictions)
    assert passed["status"] == "passed"
    assert passed["holdout"]["field_exact_match"] == 1.0
    predictions[0]["fields"]["CT01"]["value"] = -1  # type: ignore[index]
    failed = ocr_benchmark.evaluate_holdout(dataset, predictions)
    assert failed["status"] == "failed"
    assert failed["holdout"]["false_accepts"] == 1
    assert any("not marked for review" in item for item in failed["gate_failures"])
