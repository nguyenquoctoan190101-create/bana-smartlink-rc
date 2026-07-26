from __future__ import annotations

from functools import lru_cache
import ipaddress
from urllib.parse import urlsplit

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class SettingsError(RuntimeError):
    """Raised when required runtime settings are missing or invalid."""


class Settings(BaseSettings):
    # Accept both the canonical names and the names used by the distributed
    # .env.example.  Without these aliases ENVIRONMENT=production was ignored,
    # silently leaving the application in its permissive development mode.
    app_env: str = Field(
        default="development",
        validation_alias=AliasChoices("APP_ENV", "ENVIRONMENT"),
    )
    allowed_origin: str = Field(
        default="http://localhost:5173",
        validation_alias=AliasChoices("ALLOWED_ORIGIN", "ALLOWED_ORIGINS"),
    )
    database_url: str = ""
    gemini_api_key: str = ""
    gemini_api_url: str = "https://generativelanguage.googleapis.com"
    gemini_model: str = "gemini-2.5-flash"
    supabase_url: str = ""
    supabase_publishable_key: str = Field(
        default="",
        validation_alias=AliasChoices(
            "SUPABASE_PUBLISHABLE_KEY",
            "SUPABASE_ANON_KEY",
        ),
    )
    supabase_service_role_key: str = Field(
        default="",
        validation_alias=AliasChoices(
            "SUPABASE_SECRET_KEY",
            "SUPABASE_SERVICE_ROLE_KEY",
        ),
    )
    supabase_jwt_secret: str = ""
    supabase_jwt_issuer: str = ""
    supabase_jwt_audience: str = "authenticated"
    extraction_review_signing_key: str = ""
    mfa_required_roles: str = Field(
        default="",
        validation_alias=AliasChoices("MFA_REQUIRED_ROLES", "REQUIRE_MFA_FOR_ROLES"),
    )
    internal_allowed_ip_cidrs: str = Field(
        default="",
        validation_alias=AliasChoices(
            "INTERNAL_ALLOWED_IP_CIDRS",
            "INTERNAL_IP_ALLOWLIST",
        ),
    )
    feature_external_ocr: bool = Field(
        default=False,
        validation_alias=AliasChoices(
            "FEATURE_EXTERNAL_OCR",
            "ENABLE_EXTERNAL_OCR",
        ),
    )
    bana_commune_id: str = Field(default="ba_na", validation_alias=AliasChoices("BANA_COMMUNE_ID", "COMMUNE_ID"))
    feature_cases: bool = Field(default=True, validation_alias=AliasChoices("FEATURE_CASES", "ENABLE_CASES"))
    feature_voice: bool = Field(default=False, validation_alias=AliasChoices("FEATURE_VOICE", "ENABLE_VOICE"))
    feature_iot_pilot: bool = Field(default=False, validation_alias=AliasChoices("FEATURE_IOT_PILOT", "ENABLE_IOT_PILOT"))
    feature_tourism_pilot: bool = Field(default=False, validation_alias=AliasChoices("FEATURE_TOURISM_PILOT", "ENABLE_TOURISM_PILOT"))
    feature_digital_maturity: bool = Field(default=False, validation_alias=AliasChoices("FEATURE_DIGITAL_MATURITY", "ENABLE_DIGITAL_MATURITY"))
    feature_scenario_simulation: bool = Field(default=False, validation_alias=AliasChoices("FEATURE_SCENARIO_SIMULATION", "ENABLE_SCENARIO_SIMULATION"))
    vapid_private_key: str = ""
    vapid_public_key: str = ""
    vapid_contact: str = Field(
        default="mailto:admin@bana.gov.vn",
        validation_alias=AliasChoices("VAPID_CONTACT", "VAPID_CLAIMS_EMAIL"),
    )

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
        populate_by_name=True,
    )

    @property
    def normalized_supabase_url(self) -> str:
        """Return Supabase URL without a trailing slash for REST calls."""
        return self.supabase_url.rstrip("/").removesuffix("/rest/v1")

    @property
    def jwt_issuer(self) -> str:
        """Return the configured Supabase issuer, deriving the standard value."""
        if self.supabase_jwt_issuer.strip():
            return self.supabase_jwt_issuer.strip().rstrip("/")
        if self.normalized_supabase_url:
            return f"{self.normalized_supabase_url}/auth/v1"
        return ""

    @property
    def jwks_url(self) -> str:
        """Return the official public-key discovery endpoint for this project."""
        if not self.normalized_supabase_url:
            return ""
        return f"{self.normalized_supabase_url}/auth/v1/.well-known/jwks.json"

    @property
    def required_mfa_roles(self) -> frozenset[str]:
        allowed = {"admin_xa", "lanh_dao", "can_bo_thon", "to_cnscd"}
        roles = {
            value.strip().lower()
            for value in self.mfa_required_roles.split(",")
            if value.strip()
        }
        # Privileged MFA is fail-safe in deployed environments even when an
        # existing Render service has not yet synchronized the new Blueprint
        # variable. Development/test remain opt-in to keep local fixtures usable.
        if not roles and self.app_env.strip().lower() in {"staging", "production"}:
            roles = {"admin_xa", "lanh_dao"}
        unknown = roles - allowed
        if unknown:
            raise SettingsError(
                "MFA_REQUIRED_ROLES contains unsupported roles: "
                + ", ".join(sorted(unknown))
            )
        return frozenset(roles)

    @property
    def internal_ip_networks(
        self,
    ) -> tuple[ipaddress.IPv4Network | ipaddress.IPv6Network, ...]:
        networks: list[ipaddress.IPv4Network | ipaddress.IPv6Network] = []
        for value in self.internal_allowed_ip_cidrs.split(","):
            candidate = value.strip()
            if not candidate:
                continue
            try:
                networks.append(ipaddress.ip_network(candidate, strict=False))
            except ValueError as exc:
                raise SettingsError(
                    "INTERNAL_ALLOWED_IP_CIDRS contains an invalid IPv4/IPv6 CIDR"
                ) from exc
        return tuple(networks)

    def validate_for_startup(self) -> None:
        """Fail closed in staging/production without disclosing secret values."""
        environment = self.app_env.strip().lower()
        if environment not in {"development", "test", "staging", "production"}:
            raise SettingsError("APP_ENV/ENVIRONMENT has an unsupported value")

        if environment not in {"staging", "production"}:
            _ = self.required_mfa_roles
            _ = self.internal_ip_networks
            return

        if self.feature_external_ocr:
            raise SettingsError(
                "FEATURE_EXTERNAL_OCR must remain disabled in staging/production"
            )

        _ = self.required_mfa_roles
        _ = self.internal_ip_networks

        required = {
            "DATABASE_URL": self.database_url,
            "SUPABASE_URL": self.supabase_url,
            "SUPABASE_PUBLISHABLE_KEY": self.supabase_publishable_key,
            "SUPABASE_SECRET_KEY": self.supabase_service_role_key,
        }
        missing = sorted(name for name, value in required.items() if not value.strip())
        if missing:
            raise SettingsError(
                "Missing required runtime settings: " + ", ".join(missing)
            )

        origins = [value.strip() for value in self.allowed_origin.split(",") if value.strip()]
        if not origins or "*" in origins:
            raise SettingsError("ALLOWED_ORIGIN(S) must be explicit outside development")
        for origin in origins:
            parsed_origin = urlsplit(origin)
            if (
                parsed_origin.scheme != "https"
                or not parsed_origin.netloc
                or parsed_origin.username is not None
                or parsed_origin.password is not None
                or parsed_origin.query
                or parsed_origin.fragment
                or parsed_origin.path not in {"", "/"}
            ):
                raise SettingsError(
                    "ALLOWED_ORIGIN(S) must contain HTTPS origins outside development"
                )

        parsed_supabase = urlsplit(self.normalized_supabase_url)
        if (
            parsed_supabase.scheme != "https"
            or not parsed_supabase.netloc
            or parsed_supabase.username is not None
            or parsed_supabase.password is not None
        ):
            raise SettingsError("SUPABASE_URL must be an HTTPS URL")

        parsed_database = urlsplit(self.database_url)
        if parsed_database.scheme not in {"postgres", "postgresql"} or not parsed_database.hostname:
            raise SettingsError("DATABASE_URL must be a PostgreSQL DSN")

        if self.supabase_jwt_secret and len(self.supabase_jwt_secret) < 32:
            raise SettingsError("SUPABASE_JWT_SECRET must contain at least 32 characters")


@lru_cache
def load_settings() -> Settings:
    """Load Pydantic settings without printing secret values."""
    try:
        settings = Settings()
        settings.validate_for_startup()
        return settings
    except SettingsError:
        raise
    except Exception as exc:
        raise SettingsError("Missing or invalid runtime settings") from exc


__all__ = ["Settings", "SettingsError", "load_settings"]
