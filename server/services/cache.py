"""Simple in-memory TTL cache for expensive API responses."""
import time
import threading
from typing import Any

_cache: dict[str, tuple[float, Any]] = {}
_lock = threading.Lock()

# Default TTL in seconds (30 minutes — data updates every 6-48 hours so longer cache is fine)
DEFAULT_TTL = 1800


def get(key: str) -> Any | None:
    """Get a cached value if it exists and hasn't expired."""
    with _lock:
        if key in _cache:
            expires_at, value = _cache[key]
            if time.time() < expires_at:
                return value
            del _cache[key]
    return None


def set(key: str, value: Any, ttl: int = DEFAULT_TTL) -> None:
    """Cache a value with a TTL in seconds."""
    with _lock:
        _cache[key] = (time.time() + ttl, value)


def invalidate(prefix: str = "") -> None:
    """Invalidate all cache entries matching a prefix, or all if empty."""
    with _lock:
        if not prefix:
            _cache.clear()
        else:
            keys_to_delete = [k for k in _cache if k.startswith(prefix)]
            for k in keys_to_delete:
                del _cache[k]
