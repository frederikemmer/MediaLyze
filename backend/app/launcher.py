import uvicorn

from backend.app.core.config import get_settings
from backend.app.main import app


def main() -> None:
    settings = get_settings()
    uvicorn.run(app, host=settings.app_host, port=settings.app_port, ws="websockets-sansio", proxy_headers=bool(settings.trusted_proxy_ips), forwarded_allow_ips=settings.trusted_proxy_ips)


if __name__ == "__main__":
    main()
