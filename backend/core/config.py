from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Database
    database_url: str = "postgresql+asyncpg://postgres:@localhost:5432/kyc"

    # Redis
    redis_url: str = "redis://localhost:6379/0"

    # Storage
    storage_backend: str = "local"
    upload_dir: str = "C:/kyc-uploads"
    s3_endpoint: str = ""
    s3_access_key: str = ""
    s3_secret_key: str = ""
    s3_bucket: str = "kyc-documents"
    s3_region: str = "eu-west-1"

    # Auth
    jwt_secret: str = "change-me-in-production"
    api_key_salt: str = "change-me-in-production"

    # Webhook
    webhook_timeout_seconds: int = 10

    # Risk score thresholds
    score_approve_threshold: int = 75
    score_reject_threshold: int = 35

    # Retention
    document_retention_days: int = 90

    # CORS
    frontend_origin: str = "http://localhost:3000"

    # OpenAI
    openai_api_key: str = ""
    openai_model: str = "gpt-4o-mini"


settings = Settings()
