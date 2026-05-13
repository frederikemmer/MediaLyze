import ast
import re
import sys
import tomllib
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
BACKEND_ROOT = REPO_ROOT / "backend"
PYPROJECT_PATH = REPO_ROOT / "pyproject.toml"

IMPORT_TO_DISTRIBUTION = {
    "apscheduler": "apscheduler",
    "fastapi": "fastapi",
    "psutil": "psutil",
    "pydantic": "pydantic",
    "pydantic_settings": "pydantic-settings",
    "sqlalchemy": "sqlalchemy",
    "uvicorn": "uvicorn",
    "watchdog": "watchdog",
}


def _normalize_distribution_name(value: str) -> str:
    return re.split(r"[<>=!~;\\[]", value, maxsplit=1)[0].strip().lower().replace("_", "-")


def _runtime_dependency_names() -> set[str]:
    pyproject = tomllib.loads(PYPROJECT_PATH.read_text(encoding="utf-8"))
    return {
        _normalize_distribution_name(dependency)
        for dependency in pyproject["project"]["dependencies"]
    }


def _backend_top_level_imports() -> set[str]:
    imports: set[str] = set()
    for path in BACKEND_ROOT.rglob("*.py"):
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                imports.update(alias.name.split(".", 1)[0] for alias in node.names)
            elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
                imports.add(node.module.split(".", 1)[0])
    return imports


def test_backend_external_imports_are_declared_runtime_dependencies() -> None:
    runtime_dependencies = _runtime_dependency_names()
    missing: list[str] = []

    for import_name in sorted(_backend_top_level_imports()):
        if import_name in {"backend", "__future__"} or import_name in sys.stdlib_module_names:
            continue
        distribution_name = IMPORT_TO_DISTRIBUTION.get(import_name, import_name.replace("_", "-"))
        if distribution_name not in runtime_dependencies:
            missing.append(f"{import_name} -> {distribution_name}")

    assert missing == []
