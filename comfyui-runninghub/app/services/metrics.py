from __future__ import annotations

import time
from typing import Callable

from fastapi import FastAPI, Request, Response
from prometheus_client import CONTENT_TYPE_LATEST, Counter, Gauge, Histogram, generate_latest

_REQ_COUNT = Counter(
    "fasium_http_requests_total",
    "Total HTTP requests",
    ["service", "method", "path", "status"],
)
_REQ_ERRORS = Counter(
    "fasium_http_errors_total",
    "Total HTTP error responses",
    ["service", "method", "path", "status"],
)
_UPSTREAM_ERRORS = Counter(
    "fasium_upstream_errors_total",
    "Upstream dependency failures inferred by gateway-style status codes",
    ["service", "method", "path", "status"],
)
_REQ_LATENCY = Histogram(
    "fasium_http_request_duration_seconds",
    "HTTP request latency in seconds",
    ["service", "method", "path"],
    buckets=(0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 20),
)
_REQ_INFLIGHT = Gauge(
    "fasium_http_requests_in_flight",
    "In-flight HTTP requests",
    ["service"],
)


def _route_template(request: Request) -> str:
    route = request.scope.get("route")
    if route and getattr(route, "path", None):
        return str(route.path)
    return request.url.path


def setup_metrics(app: FastAPI, service_name: str) -> None:
    @app.middleware("http")
    async def metrics_middleware(request: Request, call_next: Callable):
        path = _route_template(request)
        method = request.method

        if path == "/metrics":
            return await call_next(request)

        _REQ_INFLIGHT.labels(service=service_name).inc()
        start = time.perf_counter()
        status_code = 500

        try:
            response = await call_next(request)
            status_code = response.status_code
            return response
        finally:
            elapsed = time.perf_counter() - start
            status = str(status_code)
            _REQ_INFLIGHT.labels(service=service_name).dec()
            _REQ_COUNT.labels(
                service=service_name, method=method, path=path, status=status
            ).inc()
            _REQ_LATENCY.labels(
                service=service_name, method=method, path=path
            ).observe(elapsed)
            if status_code >= 500:
                _REQ_ERRORS.labels(
                    service=service_name, method=method, path=path, status=status
                ).inc()
            if status_code in (502, 503, 504):
                _UPSTREAM_ERRORS.labels(
                    service=service_name, method=method, path=path, status=status
                ).inc()

    @app.get("/metrics", tags=["observability"])
    async def metrics_endpoint():
        return Response(content=generate_latest(), media_type=CONTENT_TYPE_LATEST)

