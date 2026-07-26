from __future__ import annotations

import hashlib
import json
import zipfile
from pathlib import Path

import zip_project
from zip_project import ROOT, _release_files


def test_deployable_release_excludes_raw_tests_and_contest_fixtures() -> None:
    paths = [path.relative_to(ROOT).as_posix() for path in _release_files()]

    assert not any("/tests/" in path or path.startswith("tests/") for path in paths)
    assert ".env.example" in paths
    assert "requirements-prod.txt" in paths
    assert "requirements-dev.txt" in paths
    assert not any(path.startswith("src/test/") or ".test." in path for path in paths)
    assert "DU_LIEU_CHINH_THUC/village_merge_map_CHINH_THUC.json" in paths
    assert not any(
        path.startswith("DU_LIEU_CHINH_THUC/")
        and path != "DU_LIEU_CHINH_THUC/village_merge_map_CHINH_THUC.json"
        for path in paths
    )


def test_release_archive_is_deterministic_and_contains_a_hashed_manifest(
    tmp_path: Path,
    monkeypatch,
) -> None:
    source = tmp_path / "source"
    source.mkdir()
    readme = source / "README.md"
    readme.write_text("Ba Na SmartLink\n", encoding="utf-8")
    monkeypatch.setattr(zip_project, "ROOT", source)
    commit = "a" * 40
    tag = "v1.0.0-rc.2"
    first = tmp_path / "one" / "BaNaSmartLink_release.zip"
    second = tmp_path / "two" / "BaNaSmartLink_release.zip"

    first_count, first_digest = zip_project.build(
        first,
        source_commit=commit,
        source_tag=tag,
    )
    second_count, second_digest = zip_project.build(
        second,
        source_commit=commit,
        source_tag=tag,
    )

    assert first_count == second_count == 1
    assert first.read_bytes() == second.read_bytes()
    assert first_digest == second_digest == hashlib.sha256(first.read_bytes()).hexdigest()
    assert first.with_suffix(".zip.sha256").read_text(encoding="ascii") == (
        f"{first_digest}  {first.name}\n"
    )
    with zipfile.ZipFile(first) as archive:
        assert archive.namelist() == ["RELEASE_MANIFEST.json", "README.md"]
        manifest = json.loads(archive.read("RELEASE_MANIFEST.json"))
    assert manifest["source"] == {
        "branch": "main",
        "commit": commit,
        "tag": tag,
        "source_of_truth": "GitHub main",
    }
    assert manifest["files"] == [
        {
            "path": "README.md",
            "size": len(readme.read_bytes()),
            "sha256": hashlib.sha256(readme.read_bytes()).hexdigest(),
        }
    ]


def test_release_state_requires_clean_main(monkeypatch) -> None:
    values = {
        ("rev-parse", "--show-toplevel"): str(ROOT),
        ("branch", "--show-current"): "main",
        ("rev-parse", "HEAD"): "b" * 40,
        ("rev-parse", "origin/main"): "b" * 40,
        ("status", "--porcelain", "--untracked-files=all"): "",
    }
    monkeypatch.setattr(zip_project, "_git", lambda *args: values[args])

    assert zip_project._verify_release_state() == "b" * 40
    values[("branch", "--show-current")] = "feature"
    try:
        zip_project._verify_release_state()
    except RuntimeError as exc:
        assert "branch must be" in str(exc)
    else:
        raise AssertionError("non-main release branch was accepted")
    values[("branch", "--show-current")] = "main"
    values[("rev-parse", "origin/main")] = "c" * 40
    try:
        zip_project._verify_release_state()
    except RuntimeError as exc:
        assert "must match origin/main" in str(exc)
    else:
        raise AssertionError("unpushed release commit was accepted")
    values[("rev-parse", "origin/main")] = "b" * 40
    values[("status", "--porcelain", "--untracked-files=all")] = " M README.md"
    try:
        zip_project._verify_release_state()
    except RuntimeError as exc:
        assert "working tree must be clean" in str(exc)
    else:
        raise AssertionError("dirty working tree was accepted")


def test_release_tag_must_uniquely_identify_source_commit(monkeypatch) -> None:
    commit = "d" * 40
    monkeypatch.setattr(zip_project, "_git", lambda *args: "v1.0.0-rc.2")

    assert zip_project._verify_release_tag(commit) == "v1.0.0-rc.2"

    monkeypatch.setattr(zip_project, "_git", lambda *args: "")
    try:
        zip_project._verify_release_tag(commit)
    except RuntimeError as exc:
        assert "must have a version tag" in str(exc)
    else:
        raise AssertionError("untagged release commit was accepted")

    monkeypatch.setattr(
        zip_project,
        "_git",
        lambda *args: "v1.0.0-rc.2\nv1.0.0",
    )
    try:
        zip_project._verify_release_tag(commit)
    except RuntimeError as exc:
        assert "exactly one matching version tag" in str(exc)
    else:
        raise AssertionError("ambiguously tagged release commit was accepted")
