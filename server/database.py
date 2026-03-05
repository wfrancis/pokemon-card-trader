import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

# On Fly.io, use /data/ volume for persistence; locally use project dir
DATA_DIR = os.environ.get("DATA_DIR", os.path.dirname(__file__))
DATABASE_PATH = os.path.join(DATA_DIR, "pokemon_cards.db")
DATABASE_URL = f"sqlite:///{DATABASE_PATH}"

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
