from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import Any, Dict, Literal, Optional
import os
import json
from pathlib import Path
from urllib.parse import urlparse

StorageType = Literal["mysql", "sqlite", "json", "postgres", "postgresql"]
ImageProviderType = Literal["poloapi", "vod", "cherryin"]
OutputStorageBackendType = Literal["local", "cos"]


class Settings(BaseSettings):
    # JWT settings
    secret_key: str = ""
    algorithm: str = "HS256"
    jwt_signing_algorithm: str = "RS256"
    jwt_verify_algorithms: str = "RS256,HS256"
    jwt_key_id: str = "v1"
    jwt_private_key_pem: Optional[str] = None
    jwt_private_key_path: Optional[str] = None
    jwt_public_key_pem: Optional[str] = None
    jwt_public_key_path: Optional[str] = None
    jwt_public_keys_json: Optional[str] = None
    jwt_allow_hs256_fallback: bool = True
    jwt_hs256_legacy_secret: Optional[str] = None
    access_token_expire_minutes: int = 30

    # Runninghub backend service
    runninghub_service_url: str = "http://localhost:8080"
    runninghub_task_timeout_seconds: int = 2400

    # LLM service configuration
    llm_service_url: Optional[str] = None
    llm_api_key: Optional[str] = None
    llm_default_model: str = "gpt-4.1"
    gemini_api_key: Optional[str] = None
    gemini_base_url: str = "https://generativelanguage.googleapis.com/v1beta/openai"
    gemini_default_model: str = "google/gemini-2.5-flash"
    openrouter_referer: Optional[str] = None
    openrouter_title: Optional[str] = None
    poloapi_base_url: str = "https://work.poloapi.com/v1"
    poloapi_text_base_url: Optional[str] = None
    poloapi_image_base_url: Optional[str] = None
    poloapi_video_base_url: Optional[str] = None
    poloapi_apikey: Optional[str] = None
    poloapi_text_apikey: Optional[str] = None
    poloapi_audit_base_url: Optional[str] = None
    poloapi_audit_apikey: Optional[str] = None
    poloapi_image_apikey: Optional[str] = None
    poloapi_default_model: str = "gemini-2.5-flash-image"
    poloapi_baokuan_model: str = "gemini-2.5-flash-image-preview"
    poloapi_singleton_model: Optional[str] = None
    poloapi_text_model: Optional[str] = None
    poloapi_audit_model: Optional[str] = None
    poloapi_image_model: Optional[str] = None
    poloapi_video_apikey: Optional[str] = None
    poloapi_video_model: str = "veo-3.1-generate-preview"
    poloapi_video_seconds: str = "12"
    poloapi_video_size: str = "720x1280"
    poloapi_video_resolution: str = "720p"
    image_provider: ImageProviderType = "poloapi"
    vod_secret_id: Optional[str] = None
    vod_secret_key: Optional[str] = None
    vod_region: str = "ap-guangzhou"
    vod_endpoint: str = "vod.tencentcloudapi.com"
    vod_http_timeout_ms: int = 300000
    vod_sub_app_id: Optional[int] = None
    vod_model_name: str = "GEM"
    vod_model_version: str = "3.1"
    vod_image2_model_version: str = "image2_medium"
    vod_image2_resolution: str = "1K"
    vod_image2_aspect_ratio: Optional[str] = None
    vod_task_poll_interval_seconds: float = 2.0
    vod_task_timeout_seconds: float = 300.0
    vod_video_model_name: str = "Kling"
    vod_video_model_version: str = "3.0-Omni"
    vod_video_duration_seconds: float = 5.0
    vod_video_resolution: str = "720P"
    vod_video_enhance_prompt: str = "Enabled"
    vod_video_audio_generation: str = "Disabled"
    vod_video_input_region: str = "Mainland"
    seedance_api_key: Optional[str] = None
    seedance_api_base_url: str = "https://ark.cn-beijing.volces.com/api/v3"
    seedance_model_id: str = "doubao-seedance-2-0-260128"
    # CherryIn API configuration (OpenAI-compatible proxy)
    cherryin_api_key: Optional[str] = None
    cherryin_base_url: str = "https://open.cherryin.net/v1"
    cherryin_model: str = "google/gemini-2.5-flash-image"
    pressure_test_mode: bool = False

    # Storage configuration (json, mysql, sqlite, postgres/postgresql)
    storage_type: StorageType = "json"

    # MySQL configuration (used when storage_type == "mysql")
    mysql_host: str = "localhost"
    mysql_port: int = 3306
    mysql_user: str = "root"
    mysql_password: str = ""
    mysql_database: str = "comfyui_tenant_service"

    # SQLite configuration (used when storage_type == "sqlite")
    sqlite_path: str = "./tenant_service.db"

    # PostgreSQL configuration (used when storage_type == "postgres/postgresql")
    postgres_host: str = "localhost"
    postgres_port: int = 5432
    postgres_user: str = "postgres"
    postgres_password: str = "postgres"
    postgres_database: str = "comfyui_tenant_service"

    # JSON storage configuration (used when storage_type == "json")
    json_storage_path: str = "./database"

    # Output storage cleanup
    output_storage_backend: OutputStorageBackendType = "local"
    output_storage_path: str = "./output"
    output_cos_secret_id: Optional[str] = None
    output_cos_secret_key: Optional[str] = None
    output_cos_bucket: Optional[str] = None
    output_cos_region: str = "ap-shanghai"
    output_cos_prefix: str = "root/fasium/output"
    output_cos_public_base_url: Optional[str] = None

    # Misc configuration
    rate_limit_per_minute: int = 60
    log_level: str = "INFO"
    redis_url: str = "redis://localhost:6379/0"
    task_queue_name: str = "tenant-task-completion"
    task_queue_enabled: bool = False
    task_queue_timeout_seconds: int = 600

    # User defaults
    user_default_credit: int = 2000
    user_default_group: int = 1001

    # Alipay sandbox/production payment configuration
    alipay_env: str = "sandbox"
    alipay_app_id: Optional[str] = None
    alipay_gateway: str = "https://openapi-sandbox.dl.alipaydev.com/gateway.do"
    alipay_public_key: Optional[str] = None
    alipay_private_key: Optional[str] = None
    alipay_private_key_base64: Optional[str] = None
    alipay_app_auth_token: Optional[str] = None
    alipay_notify_url: Optional[str] = None
    alipay_return_url: Optional[str] = None
    public_base_url: str = "http://localhost:8081"

    # Stripe sandbox/production payment configuration
    stripe_secret_key: Optional[str] = None
    stripe_webhook_secret: Optional[str] = None
    stripe_currency: str = "usd"
    stripe_success_url: Optional[str] = None
    stripe_cancel_url: Optional[str] = None

    model_config = SettingsConfigDict(
        env_file=[".env", "../.env", "../../.env"],
        env_prefix="",
        case_sensitive=False,
    )

    def get_database_url(self) -> str:
        """Return the database connection URL based on the storage type."""
        if self.storage_type == "mysql":
            return (
                f"mysql+pymysql://{self.mysql_user}:{self.mysql_password}"
                f"@{self.mysql_host}:{self.mysql_port}/{self.mysql_database}"
            )
        if self.storage_type == "sqlite":
            return f"sqlite:///{self.sqlite_path}"
        if self.storage_type in ["postgres", "postgresql"]:
            return (
                f"postgresql+psycopg2://{self.postgres_user}:{self.postgres_password}"
                f"@{self.postgres_host}:{self.postgres_port}/{self.postgres_database}"
            )
        return ""

    def is_database_storage(self) -> bool:
        """True when using SQL database storage."""
        return self.storage_type in ["mysql", "sqlite", "postgres", "postgresql"]

    def is_json_storage(self) -> bool:
        """True when using the JSON file storage backend."""
        return self.storage_type == "json"

    def get_storage_info(self) -> dict:
        """Return a dictionary describing the active storage configuration."""
        if self.storage_type == "mysql":
            return {
                "type": "MySQL",
                "host": self.mysql_host,
                "port": self.mysql_port,
                "database": self.mysql_database,
                "user": self.mysql_user,
            }
        if self.storage_type == "sqlite":
            return {
                "type": "SQLite",
                "path": self.sqlite_path,
            }
        if self.storage_type in ["postgres", "postgresql"]:
            return {
                "type": "PostgreSQL",
                "host": self.postgres_host,
                "port": self.postgres_port,
                "database": self.postgres_database,
                "user": self.postgres_user,
            }
        return {
            "type": "JSON",
            "path": self.json_storage_path,
        }

    def _is_pressure_test_url(self, raw_url: Optional[str], allowed_hosts: set[str]) -> bool:
        candidate = (raw_url or "").strip()
        if not candidate:
            return False
        parsed = urlparse(candidate)
        host = (parsed.hostname or "").strip().lower()
        if not parsed.scheme or not host:
            return False
        if host in allowed_hosts:
            return True
        if host in {"localhost", "127.0.0.1", "::1", "host.docker.internal"}:
            return True
        return False

    def validate_pressure_test_mode(self) -> None:
        """
        Fail fast when pressure-test mode is enabled but any external upstream
        endpoint is still configured.
        """
        if not self.pressure_test_mode:
            return

        mock_hosts = {"mock-models", "mock-runninghub"}
        url_checks = {
            "RUNNINGHUB_SERVICE_URL": self.runninghub_service_url,
            "LLM_SERVICE_URL": self.llm_service_url,
            "POLOAPI_BASE_URL": self.poloapi_base_url,
            "POLOAPI_TEXT_BASE_URL": self.poloapi_text_base_url,
            "POLOAPI_AUDIT_BASE_URL": self.poloapi_audit_base_url,
            "POLOAPI_IMAGE_BASE_URL": self.poloapi_image_base_url,
            "POLOAPI_VIDEO_BASE_URL": self.poloapi_video_base_url,
            "VOD_ENDPOINT": self.vod_endpoint,
        }
        for name, value in url_checks.items():
            if not self._is_pressure_test_url(value, mock_hosts):
                raise ValueError(
                    f"{name} must point to a local/mock host when PRESSURE_TEST_MODE is enabled"
                )

        if (self.image_provider or "").strip().lower() == "vod":
            raise ValueError("IMAGE_PROVIDER=vod is not allowed when PRESSURE_TEST_MODE is enabled")

        if (self.vod_secret_id or "").strip() or (self.vod_secret_key or "").strip():
            raise ValueError("VOD_SECRET_ID and VOD_SECRET_KEY must be empty when PRESSURE_TEST_MODE is enabled")

    def model_post_init(self, __context: Any) -> None:
        self.validate_pressure_test_mode()

    def get_effective_secret_key(self) -> str:
        """Return a safe JWT secret key for the current environment."""
        secret = (self.secret_key or "").strip()
        weak_defaults = {
            "",
            "your-secret-key-change-in-production",
            "change-me",
            "changeme",
            "secret",
        }
        is_prod = (
            os.getenv("ENV", "").lower() == "production"
            or os.getenv("NODE_ENV", "").lower() == "production"
        )

        if secret not in weak_defaults:
            return secret

        if is_prod:
            raise ValueError(
                "SECRET_KEY is missing or insecure. Set a strong SECRET_KEY in production."
            )

        return "dev-only-insecure-secret-change-before-production"

    def get_hs256_legacy_secret(self) -> str:
        """Return the secret used for legacy HS256 token compatibility."""
        legacy = (self.jwt_hs256_legacy_secret or "").strip()
        if legacy:
            return legacy
        return self.get_effective_secret_key()

    def get_jwt_verify_algorithms(self) -> list[str]:
        values = [item.strip().upper() for item in self.jwt_verify_algorithms.split(",")]
        return [item for item in values if item]

    def get_jwt_signing_algorithm(self) -> str:
        algorithm = (self.jwt_signing_algorithm or "").strip().upper()
        if not algorithm:
            return "HS256"
        return algorithm

    def _read_optional_pem(self, inline_value: Optional[str], path_value: Optional[str]) -> Optional[str]:
        inline = (inline_value or "").strip()
        if inline:
            return inline
        path = (path_value or "").strip()
        if not path:
            return None
        pem_path = Path(path)
        if not pem_path.exists():
            raise ValueError(f"JWT key file not found: {path}")
        return pem_path.read_text(encoding="utf-8")

    def get_jwt_private_key_pem(self) -> Optional[str]:
        return self._read_optional_pem(self.jwt_private_key_pem, self.jwt_private_key_path)

    def get_jwt_public_keys(self) -> Dict[str, str]:
        """
        Return a key map for RS256 verification.
        Priority:
        1) JWT_PUBLIC_KEYS_JSON (kid -> PEM)
        2) JWT_PUBLIC_KEY_PEM / JWT_PUBLIC_KEY_PATH with current JWT_KEY_ID
        """
        keys: Dict[str, str] = {}

        public_keys_json = (self.jwt_public_keys_json or "").strip()
        if public_keys_json:
            try:
                loaded = json.loads(public_keys_json)
            except json.JSONDecodeError as exc:
                raise ValueError("JWT_PUBLIC_KEYS_JSON must be valid JSON") from exc
            if not isinstance(loaded, dict):
                raise ValueError("JWT_PUBLIC_KEYS_JSON must be a JSON object of {kid: pem}")
            keys.update({str(k): str(v) for k, v in loaded.items() if str(v).strip()})

        single_key = self._read_optional_pem(self.jwt_public_key_pem, self.jwt_public_key_path)
        if single_key:
            keys[self.jwt_key_id] = single_key

        return keys


def get_settings() -> Settings:
    return Settings()
