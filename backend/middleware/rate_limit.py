import time

import redis.asyncio as aioredis
from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from core.config import settings

_LIMIT = 100
_WINDOW = 60  # seconds


class RateLimitMiddleware(BaseHTTPMiddleware):
    def __init__(self, app) -> None:
        super().__init__(app)
        self._redis = aioredis.from_url(settings.redis_url, decode_responses=True)

    async def dispatch(self, request: Request, call_next):
        api_key = request.headers.get("X-API-Key")
        if not api_key:
            return await call_next(request)

        key = f"rl:{api_key}"
        now = time.time()

        try:
            pipe = self._redis.pipeline()
            pipe.zremrangebyscore(key, 0, now - _WINDOW)
            pipe.zadd(key, {str(now): now})
            pipe.zcard(key)
            pipe.expire(key, _WINDOW * 2)
            results = await pipe.execute()
            count = results[2]
        except Exception:
            # Redis unavailable — fail open (don't block requests)
            return await call_next(request)

        if count > _LIMIT:
            return JSONResponse(
                status_code=429,
                content={
                    "type": "https://kyc.example/errors/rate-limit-exceeded",
                    "title": "Too Many Requests",
                    "status": 429,
                    "detail": f"Limit: {_LIMIT} requests per {_WINDOW}s.",
                },
                headers={"Retry-After": str(_WINDOW)},
            )

        response = await call_next(request)
        response.headers["X-RateLimit-Limit"] = str(_LIMIT)
        response.headers["X-RateLimit-Remaining"] = str(max(0, _LIMIT - count))
        return response
