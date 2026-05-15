from pathlib import Path

from fastapi.testclient import TestClient

from backend.app.core.config import Settings


def _build_frontend_dist(tmp_path: Path) -> Path:
    frontend_dist = tmp_path / "dist"
    assets_dir = frontend_dist / "assets"
    assets_dir.mkdir(parents=True)
    (frontend_dist / "index.html").write_text("<!doctype html><html></html>", encoding="utf-8")
    (assets_dir / "index-hash.js").write_text("console.log('ok')", encoding="utf-8")
    return frontend_dist


def test_frontend_html_is_revalidated_but_hashed_assets_are_immutable(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("CONFIG_PATH", str(tmp_path / "global-config"))
    monkeypatch.setenv("MEDIA_ROOT", str(tmp_path / "global-media"))

    from backend.app.main import create_app

    frontend_dist = _build_frontend_dist(tmp_path)
    settings = Settings(
        config_path=tmp_path / "config",
        media_root=tmp_path / "media",
        frontend_dist_path=frontend_dist,
    )
    client = TestClient(create_app(settings))

    index_response = client.get("/")
    nested_route_response = client.get("/libraries/1")
    asset_response = client.get("/assets/index-hash.js")

    assert index_response.status_code == 200
    assert index_response.headers["cache-control"] == "no-cache"
    assert nested_route_response.status_code == 200
    assert nested_route_response.headers["cache-control"] == "no-cache"
    assert asset_response.status_code == 200
    assert asset_response.headers["cache-control"] == "public, max-age=31536000, immutable"
