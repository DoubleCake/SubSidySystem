from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, DeclarativeBase

# 数据库文件放在项目根目录
DATABASE_URL = "sqlite:///./subsidy.db"

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False}  # SQLite 多线程需要
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

class Base(DeclarativeBase):
    pass

# FastAPI 依赖注入用
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
