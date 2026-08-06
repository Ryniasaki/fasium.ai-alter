import json
import uuid
from sqlalchemy import create_engine, Column, Integer, String, Date, DateTime, Boolean, Text, UniqueConstraint, text, inspect
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from sqlalchemy.sql import func
from datetime import datetime
from ..services.config import get_settings
from ..services.database_init import init_database
from ..services.logger import get_main_logger


def _parse_datetime(value):
    if not value:
        return datetime.utcnow()
    if isinstance(value, datetime):
        return value
    try:
        return datetime.fromisoformat(str(value))
    except ValueError:
        return datetime.utcnow()


def _migrate_projects_from_json(session_factory):
    try:
        from ..services.json_storage import JSONStorage
    except Exception:
        return

    storage = JSONStorage()
    try:
        projects = storage.list_projects()
    except Exception:
        return

    if not projects:
        return

    session = session_factory()
    try:
        existing = session.query(ProjectRecord).first()
        if existing:
            return

        for entry in projects:
            project_id = entry.get("project_id")
            user_id = entry.get("user_id")
            if not project_id or not user_id:
                continue

            content = entry.get("project_content") or {}
            serialized_content = json.dumps(content, ensure_ascii=False)

            created_at = _parse_datetime(entry.get("created_at"))
            updated_at = _parse_datetime(entry.get("updated_at"))

            record = ProjectRecord(
                project_id=project_id,
                user_id=user_id,
                project_content=serialized_content,
                created_at=created_at,
                updated_at=updated_at,
            )
            session.merge(record)

        session.commit()
    except Exception:
        session.rollback()
    finally:
        session.close()

def _parse_optional_datetime(value):
    if not value:
        return None
    return _parse_datetime(value)

def _migrate_project_shares_from_json(session_factory):
    try:
        from ..services.json_storage import JSONStorage
    except Exception:
        return

    storage = JSONStorage()
    try:
        shares = storage.list_project_shares()
    except Exception:
        return

    if not shares:
        return

    session = session_factory()
    try:
        existing = session.query(ProjectShareRecord).first()
        if existing:
            return

        for entry in shares:
            access_id = entry.get("access_id") or f"access_{uuid.uuid4().hex[:16]}"
            record = ProjectShareRecord(
                access_id=access_id,
                project_id=entry.get("project_id"),
                user_id=entry.get("user_id"),
                permission=entry.get("permission") or "viewer",
                granted_by_user_id=entry.get("granted_by_user_id"),
                granted_at=_parse_optional_datetime(entry.get("granted_at")),
                updated_at=_parse_optional_datetime(entry.get("updated_at")),
            )
            session.merge(record)
        session.commit()
    except Exception:
        session.rollback()
    finally:
        session.close()

def _migrate_project_invites_from_json(session_factory):
    try:
        from ..services.json_storage import JSONStorage
    except Exception:
        return

    storage = JSONStorage()
    try:
        invites = storage.list_project_invites(project_id=None)
    except Exception:
        return

    if not invites:
        return

    session = session_factory()
    try:
        existing = session.query(ProjectInviteRecord).first()
        if existing:
            return

        for entry in invites:
            invite_id = entry.get("invite_id") or f"invite_{uuid.uuid4().hex[:16]}"
            record = ProjectInviteRecord(
                invite_id=invite_id,
                project_id=entry.get("project_id"),
                owner_user_id=entry.get("owner_user_id"),
                target_user_id=entry.get("target_user_id"),
                permission=entry.get("permission") or "viewer",
                status=entry.get("status") or "pending",
                invite_token=entry.get("invite_token") or uuid.uuid4().hex,
                expires_at=_parse_optional_datetime(entry.get("expires_at")),
                message=entry.get("message"),
                created_at=_parse_optional_datetime(entry.get("created_at")) or datetime.utcnow(),
                updated_at=_parse_optional_datetime(entry.get("updated_at")) or datetime.utcnow(),
            )
            session.merge(record)
        session.commit()
    except Exception:
        session.rollback()
    finally:
        session.close()

# Initialize database
settings = get_settings()
logger = get_main_logger()

# Initialize database based on configuration
if not init_database():
    logger.warning("Database initialization failed, using JSON storage")

# Database configuration based on storage type
def _ensure_user_columns(engine):
    inspector = inspect(engine)
    try:
        columns = {col["name"] for col in inspector.get_columns("users")}
    except Exception:  # pylint: disable=broad-except
        return

    dialect = engine.dialect.name

    def quote(name: str) -> str:
        if dialect == "mysql":
            return f"`{name}`"
        return f'"{name}"'

    statements = []
    if "group" not in columns:
        statements.append(f"ALTER TABLE users ADD COLUMN {quote('group')} INTEGER DEFAULT 1001")
        columns.add("group")
    if "credit" not in columns:
        statements.append(f"ALTER TABLE users ADD COLUMN {quote('credit')} INTEGER DEFAULT 0")
        columns.add("credit")
    if "role" not in columns:
        statements.append(f"ALTER TABLE users ADD COLUMN {quote('role')} VARCHAR(20) DEFAULT 'user'")
        columns.add("role")
    if "manager_username" not in columns:
        statements.append(f"ALTER TABLE users ADD COLUMN {quote('manager_username')} VARCHAR(50)")
        columns.add("manager_username")
    if "referred_by_username" not in columns:
        statements.append(f"ALTER TABLE users ADD COLUMN {quote('referred_by_username')} VARCHAR(50)")
        columns.add("referred_by_username")
    if "max_active_employees" not in columns:
        statements.append(f"ALTER TABLE users ADD COLUMN {quote('max_active_employees')} INTEGER DEFAULT 5")
        columns.add("max_active_employees")

    if statements:
        with engine.begin() as connection:
            for stmt in statements:
                connection.execute(text(stmt))

    with engine.begin() as connection:
        if "group" in columns:
            connection.execute(
                text(f"UPDATE users SET {quote('group')} = COALESCE({quote('group')}, 1001)")
            )
        if "credit" in columns:
            connection.execute(
                text(f"UPDATE users SET {quote('credit')} = COALESCE({quote('credit')}, 0)")
            )
        if "role" in columns:
            connection.execute(
                text(f"UPDATE users SET {quote('role')} = COALESCE({quote('role')}, 'user')")
            )
            connection.execute(
                text(
                    f"UPDATE users SET {quote('role')} = 'user' "
                    f"WHERE LOWER(COALESCE({quote('role')}, '')) NOT IN ('manager', 'employee', 'user')"
                )
            )
        if "max_active_employees" in columns:
            connection.execute(
                text(
                    f"UPDATE users SET {quote('max_active_employees')} = "
                    f"COALESCE({quote('max_active_employees')}, 5)"
                )
            )

def _ensure_lora_columns(engine):
    inspector = inspect(engine)
    try:
        columns = {col["name"] for col in inspector.get_columns("tenant_lora")}
    except Exception:  # pylint: disable=broad-except
        return

    dialect = engine.dialect.name

    def quote(name: str) -> str:
        if dialect == "mysql":
            return f"`{name}`"
        return f'"{name}"'

    alterations = []
    if "training_status" not in columns:
        alterations.append(f"ADD COLUMN {quote('training_status')} INTEGER DEFAULT 1")
    if "preview_entry" not in columns:
        alterations.append(f"ADD COLUMN {quote('preview_entry')} TEXT")

    if not alterations:
        return

    with engine.begin() as connection:
        for statement in alterations:
            connection.execute(text(f"ALTER TABLE tenant_lora {statement}"))


def _ensure_billing_usage_columns(engine):
    inspector = inspect(engine)
    try:
        columns = {col["name"] for col in inspector.get_columns("billing_usage")}
    except Exception:  # pylint: disable=broad-except
        return

    dialect = engine.dialect.name

    def quote(name: str) -> str:
        if dialect == "mysql":
            return f"`{name}`"
        return f'"{name}"'

    with engine.begin() as connection:
        if "tenant_task_id" not in columns:
            connection.execute(
                text(f"ALTER TABLE billing_usage ADD COLUMN {quote('tenant_task_id')} TEXT")
            )
            columns.add("tenant_task_id")
        if "actor_user_id" not in columns:
            connection.execute(
                text(f"ALTER TABLE billing_usage ADD COLUMN {quote('actor_user_id')} INTEGER")
            )
            columns.add("actor_user_id")
        if "actor_username" not in columns:
            connection.execute(
                text(f"ALTER TABLE billing_usage ADD COLUMN {quote('actor_username')} TEXT")
            )
            columns.add("actor_username")


def _ensure_payment_order_columns(engine):
    inspector = inspect(engine)
    try:
        columns = {col["name"] for col in inspector.get_columns("payment_orders")}
    except Exception:  # pylint: disable=broad-except
        return

    dialect = engine.dialect.name

    def quote(name: str) -> str:
        if dialect == "mysql":
            return f"`{name}`"
        return f'"{name}"'

    with engine.begin() as connection:
        if "qr_code" not in columns:
            connection.execute(
                text(f"ALTER TABLE payment_orders ADD COLUMN {quote('qr_code')} TEXT")
            )
            columns.add("qr_code")


def _ensure_feedback_columns(engine):
    inspector = inspect(engine)
    try:
        columns = {col["name"] for col in inspector.get_columns("feedback_records")}
    except Exception:  # pylint: disable=broad-except
        return

    dialect = engine.dialect.name

    def quote(name: str) -> str:
        if dialect == "mysql":
            return f"`{name}`"
        return f'"{name}"'

    rewarded_at_type = "DATETIME" if dialect == "mysql" else "TIMESTAMP WITH TIME ZONE"

    statements = []
    if "reward_points" not in columns:
        statements.append(f"ALTER TABLE feedback_records ADD COLUMN {quote('reward_points')} INTEGER DEFAULT 0")
        columns.add("reward_points")
    if "rewarded_at" not in columns:
        statements.append(f"ALTER TABLE feedback_records ADD COLUMN {quote('rewarded_at')} {rewarded_at_type}")
        columns.add("rewarded_at")

    if statements:
        with engine.begin() as connection:
            for statement in statements:
                connection.execute(text(statement))

    with engine.begin() as connection:
        if "reward_points" in columns:
            connection.execute(
                text(f"UPDATE feedback_records SET {quote('reward_points')} = COALESCE({quote('reward_points')}, 0)")
            )

def _ensure_tenant_task_indexes(engine):
    inspector = inspect(engine)
    try:
        existing_indexes = {index["name"] for index in inspector.get_indexes("tenant_task_records")}
    except Exception:  # pylint: disable=broad-except
        return

    desired_indexes = {
        "idx_tenant_task_records_user_created_at": "CREATE INDEX idx_tenant_task_records_user_created_at ON tenant_task_records (user_id, created_at)",
        "idx_tenant_task_records_user_task_type_created_at": "CREATE INDEX idx_tenant_task_records_user_task_type_created_at ON tenant_task_records (user_id, task_type, created_at)",
        "idx_tenant_task_records_user_status_created_at": "CREATE INDEX idx_tenant_task_records_user_status_created_at ON tenant_task_records (user_id, status, created_at)",
        "idx_tenant_projects_user_updated_at": "CREATE INDEX idx_tenant_projects_user_updated_at ON tenant_projects (user_id, updated_at)",
    }

    with engine.begin() as connection:
        for index_name, statement in desired_indexes.items():
            if index_name in existing_indexes:
                continue
            try:
                connection.execute(text(statement))
            except Exception:
                continue

if settings.is_json_storage():
    # Use JSON storage, no SQLAlchemy needed
    engine = None
    SessionLocal = None
    Base = None
    logger.info(f"使用 JSON 存储: {settings.json_storage_path}")
else:
    # Use SQLAlchemy for database storage
    database_url = settings.get_database_url()
    engine = create_engine(
        database_url, 
        connect_args={"check_same_thread": False} if "sqlite" in database_url else {}
    )
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base = declarative_base()
    
    storage_info = settings.get_storage_info()
    logger.info(f"使用 {storage_info['type']} 数据库存储")

# Define models only if using SQLAlchemy
if Base is not None:
    class Tenant(Base):
        __tablename__ = "tenants"
        
        id = Column(Integer, primary_key=True, index=True)
        name = Column(String(100), unique=True, index=True)
        api_key = Column(String(255), unique=True, index=True)
        is_active = Column(Boolean, default=True)
        created_at = Column(DateTime, default=datetime.utcnow)
        updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
        settings = Column(Text)  # JSON string for tenant-specific settings

    class User(Base):
        __tablename__ = "users"
        
        id = Column(Integer, primary_key=True, index=True)
        username = Column(String(50), unique=True, index=True)
        email = Column(String(100), unique=True, index=True, nullable=True)
        hashed_password = Column(String(255))
        tenant_id = Column(Integer, index=True)
        is_active = Column(Boolean, default=True)
        created_at = Column(DateTime, default=datetime.utcnow)
        last_login = Column(DateTime)
        credit = Column(Integer, default=0)
        group = Column("group", Integer, default=1001)
        role = Column(String(20), default="user")
        manager_username = Column(String(50), nullable=True, index=True)
        referred_by_username = Column(String(50), nullable=True, index=True)
        max_active_employees = Column(Integer, default=5)

    class APIUsage(Base):
        __tablename__ = "api_usage"
        
        id = Column(Integer, primary_key=True, index=True)
        tenant_id = Column(Integer, index=True)
        user_id = Column(Integer, index=True)
        endpoint = Column(String(100))
        request_count = Column(Integer, default=1)
        created_at = Column(DateTime, default=datetime.utcnow)

    class ModelBillingRate(Base):
        __tablename__ = "model_billing_rates"

        id = Column(Integer, primary_key=True, index=True)
        model = Column(String(200), unique=True, index=True, nullable=False)
        credit = Column(Integer, default=1)
        created_at = Column(DateTime(timezone=True), server_default=func.now())
        updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    class BillingUsage(Base):
        __tablename__ = "billing_usage"

        id = Column(Integer, primary_key=True, index=True)
        tenant_id = Column(Integer, index=True)
        user_id = Column(Integer, index=True)
        tenant_task_id = Column(String(100), nullable=True)
        actor_user_id = Column(Integer, index=True, nullable=True)
        actor_username = Column(String(100), nullable=True)
        endpoint = Column(String(200))
        model = Column(String(200))
        credits = Column(Integer, default=1)
        status = Column(String(40), default="success")
        balance_before = Column(Integer, nullable=True)
        balance_after = Column(Integer, nullable=True)
        created_at = Column(DateTime(timezone=True), server_default=func.now())

    class PaymentOrder(Base):
        __tablename__ = "payment_orders"

        id = Column(Integer, primary_key=True, index=True)
        out_trade_no = Column(String(80), unique=True, index=True, nullable=False)
        alipay_trade_no = Column(String(100), nullable=True, index=True)
        tenant_id = Column(Integer, index=True, nullable=False)
        user_id = Column(Integer, index=True, nullable=False)
        username = Column(String(100), nullable=True)
        credits = Column(Integer, nullable=False)
        total_amount = Column(String(20), nullable=False)
        subject = Column(String(200), nullable=False)
        qr_code = Column(Text, nullable=True)
        status = Column(String(40), default="pending", index=True)
        raw_notify = Column(Text, nullable=True)
        created_at = Column(DateTime(timezone=True), server_default=func.now())
        paid_at = Column(DateTime(timezone=True), nullable=True)
        credited_at = Column(DateTime(timezone=True), nullable=True)
    
    class TenantTaskRecord(Base):
        __tablename__ = "tenant_task_records"
        
        id = Column(Integer, primary_key=True, index=True)
        tenant_task_id = Column(String(100), unique=True, index=True, nullable=False)
        user_id = Column(String(100), nullable=False, index=True)
        runninghub_task_id = Column(String(100), nullable=False, index=True)
        task_type = Column(String(50), nullable=True, index=True)  # 任务类型：如 "targeted_redesign", "image_edit" 等
        created_at = Column(DateTime(timezone=True), server_default=func.now())
        completed_at = Column(DateTime(timezone=True), nullable=True)
        status = Column(String(50), nullable=False, default="PENDING")
        result_data = Column(Text, nullable=True)
        storage_paths = Column(Text, nullable=True)
        error_message = Column(Text, nullable=True)

    class PoloAPIUsageRecord(Base):
        __tablename__ = "poloapi_usage_records"

        id = Column(Integer, primary_key=True, index=True)
        user_id = Column(String(100), nullable=False, index=True)
        model = Column(String(120), nullable=True, index=True)
        endpoint = Column(String(200), nullable=True, index=True)
        prompt = Column(Text, nullable=True)
        response_text = Column(Text, nullable=True)
        image_paths = Column(Text, nullable=True)
        created_at = Column(DateTime(timezone=True), server_default=func.now())

    class ProjectRecord(Base):
        __tablename__ = "tenant_projects"

        project_id = Column(String(100), primary_key=True, index=True)
        user_id = Column(String(100), nullable=False, index=True)
        project_content = Column(Text, nullable=True)
        created_at = Column(DateTime(timezone=True), server_default=func.now())
        updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    class ProjectShareRecord(Base):
        __tablename__ = "tenant_project_shares"

        access_id = Column(String(120), primary_key=True, index=True)
        project_id = Column(String(100), nullable=False, index=True)
        user_id = Column(String(100), nullable=False, index=True)
        permission = Column(String(50), nullable=False, default="viewer")
        granted_by_user_id = Column(String(100), nullable=True)
        granted_at = Column(DateTime(timezone=True), server_default=func.now())
        updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    class ProjectInviteRecord(Base):
        __tablename__ = "tenant_project_invites"

        invite_id = Column(String(120), primary_key=True, index=True)
        project_id = Column(String(100), nullable=False, index=True)
        owner_user_id = Column(String(100), nullable=False, index=True)
        target_user_id = Column(String(100), nullable=False, index=True)
        permission = Column(String(50), nullable=False, default="viewer")
        status = Column(String(50), nullable=False, default="pending")
        invite_token = Column(String(120), nullable=False, index=True)
        expires_at = Column(DateTime(timezone=True), nullable=True)
        message = Column(Text, nullable=True)
        created_at = Column(DateTime(timezone=True), server_default=func.now())
        updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    class TenantLoraRecord(Base):
        __tablename__ = "tenant_lora"

        id = Column(Integer, primary_key=True, index=True)
        lora_id = Column(String(120), unique=True, index=True, nullable=False)
        owner_user_id = Column(String(100), nullable=False, index=True)
        name = Column(String(200), nullable=False)
        description = Column(Text, nullable=True)
        access_user_ids = Column(Text, nullable=True)
        file_entries = Column(Text, nullable=True)
        directory = Column(String(500), nullable=True)
        training_status = Column(Integer, nullable=False, default=1)
        preview_entry = Column(Text, nullable=True)
        created_at = Column(DateTime(timezone=True), server_default=func.now())
        updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    class BoardBroadcastRecord(Base):
        __tablename__ = "board_broadcasts"

        id = Column(Integer, primary_key=True, index=True)
        title = Column(String(255), nullable=False)
        content_markdown = Column(Text, nullable=True)
        is_enabled = Column(Boolean, nullable=False, default=True)
        starts_at = Column(DateTime(timezone=True), nullable=False, index=True)
        ends_at = Column(DateTime(timezone=True), nullable=False, index=True)
        display_order = Column(Integer, nullable=False, default=0, index=True)
        created_by = Column(String(100), nullable=True)
        created_at = Column(DateTime(timezone=True), server_default=func.now())
        updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    class FeedbackRecord(Base):
        __tablename__ = "feedback_records"

        id = Column(Integer, primary_key=True, index=True)
        tenant_id = Column(Integer, index=True, nullable=False)
        user_id = Column(Integer, index=True, nullable=False)
        username = Column(String(100), nullable=False, index=True)
        content = Column(Text, nullable=False)
        attachments = Column(Text, nullable=True)
        reward_points = Column(Integer, nullable=False, default=0)
        rewarded_at = Column(DateTime(timezone=True), nullable=True)
        created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)

    class UsageDurationEvent(Base):
        __tablename__ = "usage_duration_events"

        id = Column(Integer, primary_key=True, index=True)
        tenant_id = Column(Integer, index=True, nullable=False)
        user_id = Column(Integer, index=True, nullable=False)
        username = Column(String(100), nullable=False, index=True)
        session_id = Column(String(100), nullable=False, index=True)
        event_type = Column(String(40), nullable=False, index=True)
        page_path = Column(String(300), nullable=False, default="/")
        session_started_at = Column(DateTime(timezone=True), nullable=True)
        event_at = Column(DateTime(timezone=True), nullable=False, index=True)
        delta_ms = Column(Integer, nullable=False, default=0)
        created_at = Column(DateTime(timezone=True), server_default=func.now())

    class UsageDailyStat(Base):
        __tablename__ = "usage_daily_stats"
        __table_args__ = (
            UniqueConstraint("tenant_id", "user_id", "usage_date", name="uq_usage_daily_stats_tenant_user_date"),
        )

        id = Column(Integer, primary_key=True, index=True)
        tenant_id = Column(Integer, index=True, nullable=False)
        user_id = Column(Integer, index=True, nullable=False)
        username = Column(String(100), nullable=False, index=True)
        usage_date = Column(Date, nullable=False, index=True)
        total_online_ms = Column(Integer, nullable=False, default=0)
        event_count = Column(Integer, nullable=False, default=0)
        session_count = Column(Integer, nullable=False, default=0)
        last_session_id = Column(String(100), nullable=True)
        first_seen_at = Column(DateTime(timezone=True), nullable=True)
        last_seen_at = Column(DateTime(timezone=True), nullable=True)
        created_at = Column(DateTime(timezone=True), server_default=func.now())
        updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # Create tables
    if engine is not None:
        Base.metadata.create_all(bind=engine)
        if settings.is_database_storage():
            _ensure_user_columns(engine)
            _ensure_lora_columns(engine)
            _ensure_billing_usage_columns(engine)
            _ensure_payment_order_columns(engine)
            _ensure_feedback_columns(engine)
            _ensure_tenant_task_indexes(engine)
            if SessionLocal is not None:
                _migrate_projects_from_json(SessionLocal)
                _migrate_project_shares_from_json(SessionLocal)
                _migrate_project_invites_from_json(SessionLocal)
else:
    # For JSON storage, create dummy classes to avoid import errors
    class Tenant:
        pass
    
    class User:
        pass
    
    class APIUsage:
        pass

    class ModelBillingRate:
        pass

    class BillingUsage:
        pass

    class PaymentOrder:
        pass
    
    class TenantTaskRecord:
        pass

    class ProjectRecord:
        pass

    class ProjectShareRecord:
        pass

    class ProjectInviteRecord:
        pass

    class TenantLoraRecord:
        pass

    class BoardBroadcastRecord:
        pass

    class FeedbackRecord:
        pass

    class PoloAPIUsageRecord:
        pass

    class UsageDurationEvent:
        pass

    class UsageDailyStat:
        pass

def get_db():
    if SessionLocal is not None:
        db = SessionLocal()
        try:
            yield db
        finally:
            db.close()
    else:
        # Return JSON storage for JSON mode
        from ..services.json_storage import JSONStorage
        yield JSONStorage()
