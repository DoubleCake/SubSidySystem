"""
认证模块：JWT 登录 / 密码管理 / 用户管理
支持 AUTH_DISABLED 环境变量开关，设为 1/true/yes 可跳过登录
"""
import os
import bcrypt
import jwt
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional

from database import get_db
from models import User

router = APIRouter(prefix="/api/auth", tags=["认证"])

JWT_SECRET = os.getenv("JWT_SECRET", "subsidy-system-jwt-secret-change-in-production")
JWT_ALGORITHM = "HS256"
TOKEN_EXPIRE_HOURS = 24

AUTH_DISABLED = os.getenv("AUTH_DISABLED", "").lower() in ("1", "true", "yes")

security = HTTPBearer(auto_error=False)


# ── Pydantic schemas ──
class LoginRequest(BaseModel):
    username: str
    password: str

class ChangePasswordRequest(BaseModel):
    old_password: str
    new_password: str

class CreateUserRequest(BaseModel):
    username: str
    password: str
    display_name: Optional[str] = None
    role: str = "operator"


# ── Token helpers ──
def create_token(user_id: int, username: str, role: str) -> str:
    payload = {
        "user_id": user_id,
        "username": username,
        "role": role,
        "exp": datetime.utcnow() + timedelta(hours=TOKEN_EXPIRE_HOURS),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
    db: Session = Depends(get_db),
) -> User:
    # ── 认证关闭模式：返回虚拟管理员用户 ──
    if AUTH_DISABLED:
        dummy = User(
            id=0,
            username="local",
            display_name="本地用户",
            role="admin",
            is_active=True,
        )
        return dummy

    if not credentials:
        raise HTTPException(status_code=401, detail="未登录")
    try:
        payload = jwt.decode(credentials.credentials, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        user_id = payload.get("user_id")
        if not user_id:
            raise HTTPException(status_code=401, detail="无效令牌")
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="登录已过期，请重新登录")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="无效令牌")

    user = db.get(User, user_id)
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="用户不存在或已禁用")
    return user


def get_admin_user(current: User = Depends(get_current_user)) -> User:
    if current.role != "admin":
        raise HTTPException(status_code=403, detail="需要管理员权限")
    return current


# ── 认证状态 ──
@router.get("/status")
def auth_status():
    return {
        "auth_enabled": not AUTH_DISABLED,
        "message": "认证已关闭（本地模式）" if AUTH_DISABLED else "认证已开启",
    }


# ── 登录 ──
@router.post("/login")
def login(data: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == data.username).first()
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="用户名或密码错误")
    if not bcrypt.checkpw(data.password.encode(), user.password_hash.encode()):
        raise HTTPException(status_code=401, detail="用户名或密码错误")

    user.last_login = datetime.utcnow()
    db.commit()

    token = create_token(user.id, user.username, user.role)
    return {
        "token": token,
        "user_id": user.id,
        "username": user.username,
        "display_name": user.display_name or user.username,
        "role": user.role,
    }


# ── 当前用户信息 ──
@router.get("/me")
def me(current: User = Depends(get_current_user)):
    return {
        "user_id": current.id,
        "username": current.username,
        "display_name": current.display_name or current.username,
        "role": current.role,
    }


# ── 修改密码 ──
@router.post("/change-password")
def change_password(data: ChangePasswordRequest, current: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not bcrypt.checkpw(data.old_password.encode(), current.password_hash.encode()):
        raise HTTPException(status_code=400, detail="原密码错误")
    current.password_hash = bcrypt.hashpw(data.new_password.encode(), bcrypt.gensalt()).decode()
    db.commit()
    return {"message": "密码已修改"}


# ── 用户管理（管理员） ──
@router.get("/users")
def list_users(current: User = Depends(get_admin_user), db: Session = Depends(get_db)):
    users = db.query(User).order_by(User.id).all()
    return [{"id": u.id, "username": u.username, "display_name": u.display_name, "role": u.role, "is_active": u.is_active} for u in users]


@router.post("/users")
def create_user(data: CreateUserRequest, current: User = Depends(get_admin_user), db: Session = Depends(get_db)):
    if db.query(User).filter(User.username == data.username).first():
        raise HTTPException(status_code=400, detail="用户名已存在")
    user = User(
        username=data.username,
        password_hash=bcrypt.hashpw(data.password.encode(), bcrypt.gensalt()).decode(),
        display_name=data.display_name or data.username,
        role=data.role,
    )
    db.add(user)
    db.commit()
    return {"id": user.id, "message": "用户创建成功"}


@router.put("/users/{user_id}")
def toggle_user(user_id: int, data: dict, current: User = Depends(get_admin_user), db: Session = Depends(get_db)):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    if "is_active" in data:
        user.is_active = bool(data["is_active"])
    if "role" in data:
        user.role = data["role"]
    db.commit()
    return {"message": "更新成功"}


# ── 初始化管理员 ──
def ensure_admin(db: Session):
    admin = db.query(User).filter(User.username == "admin").first()
    if not admin:
        admin = User(
            username="admin",
            password_hash=bcrypt.hashpw("admin123".encode(), bcrypt.gensalt()).decode(),
            display_name="管理员",
            role="admin",
        )
        db.add(admin)
        db.commit()
