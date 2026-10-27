"""Additive local identity storage. No foreign keys from durable job provenance to accounts."""

from sqlalchemy import Boolean, CheckConstraint, ForeignKey, Integer, JSON, String
from sqlalchemy.orm import Mapped, mapped_column
from backend.app.db.base import Base


class LocalAccount(Base):
    __tablename__ = "local_accounts"
    __table_args__ = (CheckConstraint("owner_slot IS NULL OR owner_slot = 1"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    username: Mapped[str] = mapped_column(String(64), nullable=False)
    username_key: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(512), nullable=False)
    owner_slot: Mapped[int | None] = mapped_column(Integer, unique=True, nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    must_change_password: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    revision: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    policy: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    preferences: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)


class AccessState(Base):
    __tablename__ = "access_state"
    __table_args__ = (CheckConstraint("id = 1"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    owner_id: Mapped[str] = mapped_column(
        ForeignKey("local_accounts.id", ondelete="RESTRICT"), unique=True
    )
    guest_enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    guest_policy: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    revision: Mapped[int] = mapped_column(Integer, default=1, nullable=False)


class LoginSession(Base):
    __tablename__ = "login_sessions"
    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    account_id: Mapped[str | None] = mapped_column(
        ForeignKey("local_accounts.id", ondelete="CASCADE"), index=True
    )
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    created_at: Mapped[int] = mapped_column(Integer, nullable=False)
    last_seen_at: Mapped[int] = mapped_column(Integer, nullable=False)


class LoginThrottle(Base):
    __tablename__ = "login_throttles"
    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    started_at: Mapped[int] = mapped_column(Integer, nullable=False)
    attempts: Mapped[int] = mapped_column(Integer, nullable=False)


class JobAuthority(Base):
    __tablename__ = "job_authorities"
    key: Mapped[str] = mapped_column(String(96), primary_key=True)
    actor_kind: Mapped[str] = mapped_column(String(16), nullable=False)
    actor_id: Mapped[str] = mapped_column(String(36), nullable=False)
    actor_name: Mapped[str] = mapped_column(String(64), nullable=False)
    requirements: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
