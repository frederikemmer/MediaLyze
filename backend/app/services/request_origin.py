"""Browser-facing origin without trusting proxy-supplied forwarding headers."""

from urllib.parse import urlsplit


def browser_origin(request):
    # Origin is supplied by the browser for writes; our frontend supplies its
    # location for reads, where browsers do not normally send Origin. Neither
    # header is trusted for host selection: it must match the received Host.
    value = request.headers.get("origin") or request.headers.get("x-medialyze-origin")
    if value:
        try:
            parsed = urlsplit(value)
            if (parsed.scheme in {"http", "https"} and parsed.netloc == request.url.netloc
                    and not parsed.username and not parsed.password
                    and not parsed.path and not parsed.query and not parsed.fragment
                    and not (request.url.scheme == "https" and parsed.scheme != "https")):
                return value
        except ValueError:
            pass
    return f"{request.url.scheme}://{request.url.netloc}"


def secure_cookie(request):
    return browser_origin(request).startswith("https://")
