from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker, DeclarativeBase

# 数据库文件路径，支持环境变量（Docker 部署时挂载到 /app/data/）
import os
DB_PATH = os.getenv("DATABASE_PATH", os.path.join(os.path.dirname(os.path.abspath(__file__)), "subsidy.db"))
DATABASE_URL = f"sqlite:///{DB_PATH}"

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False}  # SQLite 多线程需要
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


# 注册 format_group_no 为 SQLite 函数，供 SQL 内部调用
@event.listens_for(engine, "connect")
def register_sqlite_functions(dbapi_conn, connection_record):
    def _format_group_no(n):
        """将整数 1→'一组'，供 SQL 使用"""
        if n is None:
            return "一组"
        digits = "零一二三四五六七八九十"
        if 1 <= n <= 10:
            return f"{digits[n]}组"
        return f"{n}组"

    dbapi_conn.create_function("format_group_no", 1, _format_group_no)


class Base(DeclarativeBase):
    pass


# FastAPI 依赖注入用
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
