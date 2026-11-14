from argon2 import PasswordHasher
import secrets
import os
from urllib.parse import urlsplit
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError


_password_hasher = PasswordHasher()


def hash_password(password: str) -> str:
    return _password_hasher.hash(password)


# One hash per process, using the same parameters as real accounts.
DUMMY_PASSWORD_HASH = hash_password(secrets.token_urlsafe(32))


def trusted_origins(secure_cookie: bool) -> set[str]:
    defaults = "" if secure_cookie else ",".join(
        f"http://{host}:{port}" for host in ("localhost", "127.0.0.1") for port in (5173, 8000)
    )
    origins = {value.strip() for value in os.environ.get("AUTH_TRUSTED_ORIGINS", defaults).split(",") if value.strip()}
    for origin in origins:
        parsed = urlsplit(origin)
        if (parsed.scheme not in {"http", "https"} or not parsed.netloc or parsed.hostname is None
                or parsed.username or parsed.password or parsed.path or parsed.query or parsed.fragment
                or "*" in origin or (secure_cookie and parsed.scheme != "https")):
            raise ValueError("AUTH_TRUSTED_ORIGINS must contain exact origins without paths; HTTPS required for Secure cookies")
    if secure_cookie and not origins:
        raise ValueError("Set AUTH_TRUSTED_ORIGINS for HTTPS deployment")
    return origins


def verify_password(password_hash: str, password: str) -> bool:
    try:
        return _password_hasher.verify(password_hash, password)
    except (InvalidHashError, VerificationError, VerifyMismatchError):
        return False
