from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional, Dict, Any
from datetime import datetime
import uuid, redis, json, os

from database import get_db, init_db, Conversation, Message, InferenceLog
from pii_redactor import redact_pii

app = FastAPI(title="Ollive Ingestion Service")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "https://ollive-inference-logger.vercel.app/",  # your vercel URL
        "*"  # or just keep this for now
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
redis_client = redis.from_url(REDIS_URL, decode_responses=True)

@app.on_event("startup")
def startup():
    init_db()

# ── Pydantic schemas ──────────────────────────────────────────────────────────

class IngestPayload(BaseModel):
    conversation_id: str
    message_id: str
    provider: str
    model: str
    role: str
    content: str
    latency_ms: float
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int
    status: str
    error_message: Optional[str] = None
    timestamp: str
    metadata: Optional[Dict[str, Any]] = {}

class ConversationCreate(BaseModel):
    provider: str
    model: str
    title: Optional[str] = None

# ── Ingestion endpoint ────────────────────────────────────────────────────────

@app.post("/ingest")
def ingest_log(payload: IngestPayload, db: Session = Depends(get_db)):
    # Redact PII from content
    clean_content = redact_pii(payload.content)
    preview = clean_content[:200]

    # Upsert conversation
    conv = db.query(Conversation).filter_by(id=payload.conversation_id).first()
    if not conv:
        conv = Conversation(
            id=payload.conversation_id,
            provider=payload.provider,
            model=payload.model,
            title=f"Chat {payload.conversation_id[:8]}"
        )
        db.add(conv)
    conv.updated_at = datetime.utcnow()

    # Store message
    msg = Message(
        id=payload.message_id,
        conversation_id=payload.conversation_id,
        role=payload.role,
        content=clean_content,
        content_preview=preview,
    )
    db.add(msg)

    # Store inference log (only for assistant turns)
    if payload.role == "assistant":
        log = InferenceLog(
            id=str(uuid.uuid4()),
            conversation_id=payload.conversation_id,
            message_id=payload.message_id,
            provider=payload.provider,
            model=payload.model,
            latency_ms=payload.latency_ms,
            prompt_tokens=payload.prompt_tokens,
            completion_tokens=payload.completion_tokens,
            total_tokens=payload.total_tokens,
            status=payload.status,
            error_message=payload.error_message,
            timestamp=datetime.fromisoformat(payload.timestamp),
            extra_metadata=payload.metadata,
        )
        db.add(log)

    db.commit()

    # Publish to Redis stream (event-based arch bonus)
    redis_client.xadd("inference_logs", {"data": payload.model_dump_json()})

    return {"status": "ok", "message_id": payload.message_id}

# ── Conversations API ─────────────────────────────────────────────────────────

@app.post("/conversations")
def create_conversation(body: ConversationCreate, db: Session = Depends(get_db)):
    conv = Conversation(
        id=str(uuid.uuid4()),
        provider=body.provider,
        model=body.model,
        title=body.title or "New Chat",
    )
    db.add(conv)
    db.commit()
    return {"id": conv.id, "title": conv.title}

@app.get("/conversations")
def list_conversations(db: Session = Depends(get_db)):
    convs = db.query(Conversation).order_by(Conversation.updated_at.desc()).all()
    return [{"id": c.id, "title": c.title, "provider": c.provider,
             "model": c.model, "is_active": c.is_active,
             "created_at": c.created_at, "updated_at": c.updated_at} for c in convs]

@app.get("/conversations/{conv_id}/messages")
def get_messages(conv_id: str, db: Session = Depends(get_db)):
    msgs = db.query(Message).filter_by(conversation_id=conv_id)\
             .order_by(Message.created_at).all()
    return [{"id": m.id, "role": m.role, "content": m.content,
             "created_at": m.created_at} for m in msgs]

@app.delete("/conversations/{conv_id}")
def cancel_conversation(conv_id: str, db: Session = Depends(get_db)):
    conv = db.query(Conversation).filter_by(id=conv_id).first()
    if not conv:
        raise HTTPException(status_code=404, detail="Not found")
    conv.is_active = 0
    db.commit()
    return {"status": "cancelled"}

# ── Metrics API ───────────────────────────────────────────────────────────────

@app.get("/metrics/summary")
def metrics_summary(db: Session = Depends(get_db)):
    from sqlalchemy import func
    logs = db.query(InferenceLog).all()
    if not logs:
        return {"total_requests": 0, "avg_latency_ms": 0,
                "error_rate": 0, "total_tokens": 0}
    total = len(logs)
    errors = sum(1 for l in logs if l.status == "error")
    avg_latency = sum(l.latency_ms for l in logs) / total
    total_tokens = sum(l.total_tokens or 0 for l in logs)
    return {
        "total_requests": total,
        "avg_latency_ms": round(avg_latency, 2),
        "error_rate": round(errors / total * 100, 2),
        "total_tokens": total_tokens,
    }

@app.get("/metrics/timeseries")
def metrics_timeseries(db: Session = Depends(get_db)):
    logs = db.query(InferenceLog).order_by(InferenceLog.timestamp).all()
    return [{"timestamp": l.timestamp.isoformat(), "latency_ms": l.latency_ms,
             "total_tokens": l.total_tokens, "status": l.status,
             "provider": l.provider} for l in logs]

@app.get("/health")
def health():
    return {"status": "ok"}