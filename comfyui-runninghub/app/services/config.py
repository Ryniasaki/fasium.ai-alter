from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    runninghub_api_key: str
    runninghub_host: str = "https://www.runninghub.cn"
    request_timeout_seconds: int = 60
    poll_interval_seconds: int = 8
    max_poll_seconds: int = 300

    model_config = SettingsConfigDict(env_file=[".env", "../.env", "../../.env"], env_prefix="", case_sensitive=False)


def get_settings() -> Settings:
    return Settings()

