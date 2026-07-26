from __future__ import annotations

import ipaddress
from collections.abc import Iterable


IpNetwork = ipaddress.IPv4Network | ipaddress.IPv6Network


def is_internal_request(
    client_host: str | None,
    allowed_networks: Iterable[IpNetwork],
) -> bool:
    """Return whether the proxy-normalized client address is allowlisted.

    Uvicorn is configured to trust only the Render ingress path in deployment.
    This function deliberately does not parse X-Forwarded-For itself: doing so
    inside the application would allow a direct client to spoof its address.
    """

    networks = tuple(allowed_networks)
    if not networks:
        return True
    if not client_host:
        return False
    candidate = client_host.strip()
    if candidate.startswith("[") and "]" in candidate:
        candidate = candidate[1 : candidate.index("]")]
    try:
        address = ipaddress.ip_address(candidate)
    except ValueError:
        return False
    return any(address.version == network.version and address in network for network in networks)


def requires_internal_network(path: str, authorization: str | None) -> bool:
    """Keep the citizen portal public while protecting authenticated traffic."""

    normalized = path or "/"
    return normalized == "/app" or normalized.startswith("/app/") or bool(
        authorization and authorization.lower().startswith("bearer ")
    )


__all__ = ["is_internal_request", "requires_internal_network"]
