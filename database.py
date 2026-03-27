from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker, DeclarativeBase

# 数据库文件放在项目根目录
DATABASE_URL = "sqlite:///./subsidy.db"

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False}  # SQLite 多线程需要
)


def _cn_to_int(n: int) -> int:
    """将 1~10 的整数转为中文数字（供 SQLite 使用）"""
    digits = "零一二三四五六七八九十"
    if 1 <= n <= 10:
        return digits[n]
    return ""


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
