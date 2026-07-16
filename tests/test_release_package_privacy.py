from __future__ import annotations

from zip_project import ROOT, _release_files


def test_deployable_release_excludes_raw_tests_and_contest_fixtures() -> None:
    paths = [path.relative_to(ROOT).as_posix() for path in _release_files()]

    assert not any("/tests/" in path or path.startswith("tests/") for path in paths)
    assert ".env.example" not in paths
    assert not any(path.startswith("src/test/") or ".test." in path for path in paths)
    assert "DU_LIEU_CHINH_THUC/village_merge_map_CHINH_THUC.json" in paths
    assert not any(
        path.startswith("DU_LIEU_CHINH_THUC/")
        and path != "DU_LIEU_CHINH_THUC/village_merge_map_CHINH_THUC.json"
        for path in paths
    )
