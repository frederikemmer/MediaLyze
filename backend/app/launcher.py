import uvicorn

from backend.app.core.config import get_settings
from backend.app.main import app


def main() -> None:
    settings = get_settings()
    uvicorn.run(app, host=settings.app_host, port=settings.app_port)


if __name__ == "__main__":
    main()
