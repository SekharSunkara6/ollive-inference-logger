from sqlalchemy import create_engine, Column, String, Integer, Float, DateTime, Text, JSON
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from datetime import datetime
import os

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://ollive:ollive@127.0.0.1:5434/ollive")

engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

class Conversation(Base):
    __tablename__ = "conversations"
    id = Column(String, primary_key=True)
    title = Column(String, nullable=True)
    provider = Column(String)
    model = Column(String)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow)
    is_active = Column(Integer, default=1)  # 0 = cancelled

class Message(Base):
    __tablename__ = "messages"
    id = Column(String, primary_key=True)
    conversation_id = Column(String, nullable=False)
    role = Column(String)           # user | assistant
    content = Column(Text)
    content_preview = Column(String(200))
    created_at = Column(DateTime, default=datetime.utcnow)

class InferenceLog(Base):
    __tablename__ = "inference_logs"
    id = Column(String, primary_key=True)
    conversation_id = Column(String)
    message_id = Column(String)
    provider = Column(String)
    model = Column(String)
    latency_ms = Column(Float)
    prompt_tokens = Column(Integer)
    completion_tokens = Column(Integer)
    total_tokens = Column(Integer)
    status = Column(String)         # success | error
    error_message = Column(Text, nullable=True)
    timestamp = Column(DateTime, default=datetime.utcnow)
    extra_metadata = Column(JSON, nullable=True)

def init_db():
    Base.metadata.create_all(bind=engine)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()