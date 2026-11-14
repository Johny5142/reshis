"""Thread-safe fixed-window limits for one API process."""
import hashlib
import math
import os
import threading
import time

from fastapi import HTTPException


def positive_env(name: str, default: int) -> int:
    value = int(os.environ.get(name, default))
    if value < 1:
        raise ValueError(f"{name} must be positive")
    return value


class AuthLimiter:
    def __init__(self):
        self.window = positive_env("AUTH_RATE_WINDOW_SECONDS", 900)
        self.max_keys = positive_env("AUTH_RATE_MAX_KEYS", 10000)
        self.limits = {
            ("login", "ip"): positive_env("AUTH_LOGIN_IP_LIMIT", 60),
            ("login", "email"): positive_env("AUTH_LOGIN_EMAIL_LIMIT", 20),
            ("register", "ip"): positive_env("AUTH_REGISTER_IP_LIMIT", 20),
            ("register", "email"): positive_env("AUTH_REGISTER_EMAIL_LIMIT", 5),
        }
        self.buckets = {}
        self.lock = threading.Lock()

    def consume(self, action: str, kind: str, identity: str) -> None:
        key = (action, kind, hashlib.sha256(identity.encode()).hexdigest())
        now = time.monotonic()
        with self.lock:
            self.buckets = {k: v for k, v in self.buckets.items() if v[0] > now}
            expires, count = self.buckets.get(key, (now + self.window, 0))
            retry = None
            if count >= self.limits[(action, kind)]:
                retry = expires - now
            elif key not in self.buckets and len(self.buckets) >= self.max_keys:
                retry = min(v[0] for v in self.buckets.values()) - now
            if retry is not None:
                raise HTTPException(
                    status_code=429, detail="Слишком много попыток. Повторите позже.",
                    headers={"Retry-After": str(max(1, math.ceil(retry)))},
                )
            self.buckets[key] = (expires, count + 1)
