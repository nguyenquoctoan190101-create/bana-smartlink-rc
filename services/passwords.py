from __future__ import annotations

import secrets
import string


def generate_temporary_password(length: int = 16) -> str:
    """Generate a temporary password with mixed character classes."""
    if length < 12:
        raise ValueError("Temporary password length must be at least 12")

    groups = [
        string.ascii_lowercase,
        string.ascii_uppercase,
        string.digits,
        "!@#$%^&*",
    ]
    password_chars = [secrets.choice(group) for group in groups]
    alphabet = "".join(groups)
    password_chars.extend(secrets.choice(alphabet) for _ in range(length - len(groups)))
    secrets.SystemRandom().shuffle(password_chars)
    return "".join(password_chars)


__all__ = ["generate_temporary_password"]
