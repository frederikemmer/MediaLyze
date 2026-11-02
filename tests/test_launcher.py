import socket
import time
from threading import Thread
from types import SimpleNamespace

import httpx
import uvicorn
from fastapi import FastAPI, WebSocket
from websockets.sync.client import connect


def test_launcher_serves_http_and_websocket_frames(monkeypatch) -> None:
    from backend.app import launcher

    app = FastAPI()

    @app.get("/health")
    async def health():
        return {"ok": True}

    @app.websocket("/echo")
    async def echo(websocket: WebSocket):
        await websocket.accept(subprotocol="echo")
        while True:
            message = await websocket.receive()
            if message["type"] == "websocket.disconnect":
                return
            if "text" in message:
                await websocket.send_text(message["text"])
            else:
                await websocket.send_bytes(message["bytes"])

    servers = []

    # Exercise the launcher's real protocol choice over TCP, while keeping
    # application startup and the database outside this transport test.
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
        listener.bind(("127.0.0.1", 0))
        port = listener.getsockname()[1]

        def run(application, **kwargs):
            server = uvicorn.Server(uvicorn.Config(
                application, **kwargs, log_level="error", lifespan="off",
            ))
            servers.append(server)
            server.run(sockets=[listener])

        monkeypatch.setattr(launcher, "app", app)
        monkeypatch.setattr(launcher, "get_settings", lambda: SimpleNamespace(
            app_host="127.0.0.1", app_port=port, trusted_proxy_ips="",
        ))
        monkeypatch.setattr(launcher.uvicorn, "run", run)
        thread = Thread(target=launcher.main, daemon=True)
        thread.start()
        try:
            deadline = time.monotonic() + 5
            while not (servers and servers[0].started) and thread.is_alive() and time.monotonic() < deadline:
                time.sleep(0.01)
            assert servers and servers[0].started
            assert servers[0].config.proxy_headers is False
            response = httpx.get(f"http://127.0.0.1:{port}/health", timeout=5, trust_env=False)
            assert response.status_code == 200
            assert response.json() == {"ok": True}
            with connect(
                f"ws://127.0.0.1:{port}/echo", subprotocols=["echo"], open_timeout=5, close_timeout=5,
            ) as connection:
                assert connection.subprotocol == "echo"
                connection.send("Grüße")
                assert connection.recv(timeout=5) == "Grüße"
                connection.send(b"\x00\xff\x01")
                assert connection.recv(timeout=5) == b"\x00\xff\x01"
                assert connection.ping().wait(timeout=5)
            assert connection.close_code == 1000
        finally:
            for server in servers:
                server.should_exit = True
            thread.join(timeout=5)
        assert not thread.is_alive()
