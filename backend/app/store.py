from __future__ import annotations

import json
import os
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

DB_PATH = Path(__file__).resolve().parents[1] / "data" / "eventconnect.db"


def utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


class PostgresRow(dict):
    def __getitem__(self, key: Any) -> Any:
        if isinstance(key, int):
            return list(self.values())[key]
        return super().__getitem__(key)


class PostgresCursor:
    def __init__(self, cursor: Any) -> None:
        self.cursor = cursor

    @staticmethod
    def _row(row: Any) -> PostgresRow | None:
        return PostgresRow(row) if row is not None else None

    def fetchone(self) -> PostgresRow | None:
        return self._row(self.cursor.fetchone())

    def fetchall(self) -> list[PostgresRow]:
        return [PostgresRow(row) for row in self.cursor.fetchall()]


class PostgresConnection:
    def __init__(self, connection: Any) -> None:
        self.connection = connection

    def __enter__(self) -> PostgresConnection:
        self.connection.__enter__()
        return self

    def __exit__(self, exc_type: Any, exc: Any, traceback: Any) -> None:
        try:
            self.connection.__exit__(exc_type, exc, traceback)
        finally:
            self.connection.close()

    def execute(self, query: str, parameters: tuple | list = ()) -> PostgresCursor:
        return PostgresCursor(
            self.connection.execute(query.replace("?", "%s"), parameters)
        )


class Store:
    def __init__(self, path: Path = DB_PATH) -> None:
        self.path = path
        self.database_url = os.environ.get("DATABASE_URL")
        if os.environ.get("EVENTCONNECT_ENV") == "production":
            required = (
                "DATABASE_URL",
                "SUPABASE_URL",
                "SUPABASE_ANON_KEY",
                "SUPABASE_SERVICE_ROLE_KEY",
            )
            missing = [key for key in required if not os.environ.get(key)]
            if missing:
                raise RuntimeError(
                    "Production storage configuration is incomplete: " + ", ".join(missing)
                )
            if os.environ.get("SUPABASE_STORAGE_BUCKET", "eventconnect-cards") != "eventconnect-cards":
                raise RuntimeError("The applied migration provisions only the eventconnect-cards Storage bucket.")
            if not self.database_url:
                raise RuntimeError("Production requires PostgreSQL DATABASE_URL; SQLite is development-only.")
            if len(os.environ.get("EVENTCONNECT_API_TOKEN", "")) < 32:
                raise RuntimeError("Production requires EVENTCONNECT_API_TOKEN with at least 32 characters.")
        if not self.database_url:
            path.parent.mkdir(parents=True, exist_ok=True)
        self._initialize()

    def connect(self) -> Any:
        if self.database_url:
            try:
                import psycopg
                from psycopg.rows import dict_row
            except ImportError as error:
                raise RuntimeError(
                    "PostgreSQL support requires the psycopg[binary] dependency."
                ) from error
            return PostgresConnection(
                psycopg.connect(self.database_url, row_factory=dict_row, connect_timeout=10)
            )
        connection = sqlite3.connect(self.path, timeout=30)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        return connection

    def _initialize(self) -> None:
        if self.database_url:
            return
        with self.connect() as db:
            db.executescript("""
            CREATE TABLE IF NOT EXISTS captures (
                id TEXT PRIMARY KEY,
                capture_code TEXT NOT NULL UNIQUE,
                event_code TEXT NOT NULL,
                capture_method TEXT NOT NULL,
                status TEXT NOT NULL,
                verification_status TEXT NOT NULL DEFAULT 'pending',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                front_path TEXT,
                back_path TEXT,
                raw_text_front TEXT,
                raw_text_back TEXT,
                extracted_fields TEXT NOT NULL DEFAULT '{}',
                field_confidences TEXT NOT NULL DEFAULT '{}',
                field_sources TEXT NOT NULL DEFAULT '{}',
                conflicts TEXT NOT NULL DEFAULT '[]',
                manual_fields TEXT NOT NULL DEFAULT '{}',
                qualification TEXT NOT NULL DEFAULT '{}',
                idempotency_key TEXT UNIQUE NOT NULL
            );
            CREATE TABLE IF NOT EXISTS leads (
                id TEXT PRIMARY KEY,
                capture_id TEXT NOT NULL UNIQUE REFERENCES captures(id),
                full_name TEXT,
                institution TEXT,
                designation TEXT,
                email TEXT,
                mobile TEXT,
                city TEXT,
                state TEXT,
                country TEXT,
                address TEXT,
                priority TEXT NOT NULL DEFAULT 'Cold',
                status TEXT NOT NULL DEFAULT 'Needs Verification',
                capture_method TEXT NOT NULL,
                captured_at TEXT NOT NULL,
                assigned_owner TEXT,
                follow_up_at TEXT,
                consent_status TEXT NOT NULL DEFAULT 'unknown',
                search_key TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS tasks (
                id TEXT PRIMARY KEY,
                capture_id TEXT REFERENCES captures(id),
                lead_name TEXT,
                assigned_owner TEXT,
                action_type TEXT NOT NULL,
                due_at TEXT NOT NULL,
                priority TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'Pending',
                notes TEXT,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS app_sync_jobs (
                id TEXT PRIMARY KEY,
                capture_id TEXT NOT NULL REFERENCES captures(id),
                provider TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'Pending',
                attempts INTEGER NOT NULL DEFAULT 0,
                last_error TEXT,
                next_retry_at TEXT,
                idempotency_key TEXT UNIQUE NOT NULL,
                created_at TEXT NOT NULL,
                completed_at TEXT
            );
            CREATE TABLE IF NOT EXISTS audit_logs (
                id TEXT PRIMARY KEY,
                actor_id TEXT,
                action TEXT NOT NULL,
                entity_type TEXT NOT NULL,
                entity_id TEXT,
                old_values TEXT,
                new_values TEXT,
                timestamp TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_leads_search ON leads(search_key);
            CREATE INDEX IF NOT EXISTS idx_sync_status ON app_sync_jobs(status, provider);
            CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_logs(timestamp DESC);
            """)

    def record_audit(
        self,
        actor_id: str | None,
        action: str,
        entity_type: str,
        entity_id: str,
        old_values: dict | None = None,
        new_values: dict | None = None,
    ) -> None:
        actor_key = None
        if actor_id:
            try:
                actor_key = str(uuid.UUID(actor_id))
            except (ValueError, AttributeError):
                actor_key = None
        with self.connect() as db:
            db.execute(
                "INSERT INTO audit_logs(id,actor_id,action,entity_type,entity_id,old_values,new_values,timestamp) "
                "VALUES(?,?,?,?,?,?,?,?)",
                (
                    str(uuid.uuid4()),
                    actor_key,
                    action,
                    entity_type,
                    entity_id,
                    json.dumps(old_values) if old_values is not None else None,
                    json.dumps(new_values) if new_values is not None else None,
                    utcnow(),
                ),
            )

    def list_events(self) -> list[dict]:
        if not self.database_url:
            now = utcnow()
            return [{
                "id": "00000000-0000-0000-0000-000000000001",
                "name": "DIDAC 2026",
                "event_code": "DIDAC26",
                "venue": "BIEC, Bengaluru",
                "start_date": "2026-11-12",
                "end_date": "2026-11-14",
                "status": "active",
                "created_at": now,
            }]
        with self.connect() as db:
            rows = db.execute(
                "SELECT id,name,event_code,venue,start_date,end_date,status,created_at "
                "FROM events ORDER BY created_at DESC"
            ).fetchall()
            return [dict(row) for row in rows]

    def get_event_by_code(self, event_code: str) -> dict:
        events = self.list_events()
        for event in events:
            if event["event_code"].upper() == event_code.upper():
                return event
        raise KeyError(event_code)

    def create_event(
        self,
        name: str,
        event_code: str,
        venue: str | None,
        start_date: str | None,
        end_date: str | None,
    ) -> dict:
        if not self.database_url:
            raise RuntimeError("Event administration requires PostgreSQL.")
        now = utcnow()
        with self.connect() as db:
            try:
                db.execute(
                    "INSERT INTO events(name,event_code,venue,start_date,end_date,status,created_at) "
                    "VALUES(?,?,?,?,?,?,'draft',?)",
                    (name, event_code.upper(), venue, start_date, end_date, now),
                )
            except Exception as exc:
                if self.database_url:
                    import psycopg
                    if isinstance(exc, psycopg.IntegrityError):
                        raise ValueError("event_code_conflict") from exc
                raise
            row = db.execute(
                "SELECT id,name,event_code,venue,start_date,end_date,status,created_at "
                "FROM events WHERE event_code=?",
                (event_code.upper(),),
            ).fetchone()
        return dict(row)

    def create_capture(self, capture_id: str, event_code: str, method: str, key: str, front_path: str, back_path: str | None) -> dict:
        suffix = capture_id.replace("-", "")[-8:].upper()
        code = f"{event_code.upper()}-{suffix}"
        now = utcnow()
        with self.connect() as db:
            try:
                db.execute(
                    "INSERT INTO captures(id,capture_code,event_code,capture_method,status,created_at,updated_at,front_path,back_path,idempotency_key) VALUES(?,?,?,?,?,?,?,?,?,?)",
                    (capture_id, code, event_code, method, "Received by Server", now, now, front_path, back_path, key),
                )
            except sqlite3.IntegrityError as exc:
                raise ValueError("idempotency_conflict") from exc
            except Exception as exc:
                if self.database_url:
                    import psycopg

                    if isinstance(exc, psycopg.IntegrityError):
                        raise ValueError("idempotency_conflict") from exc
                raise
        return self.get_capture(capture_id)

    def find_by_idempotency(self, key: str) -> dict | None:
        with self.connect() as db:
            row = db.execute("SELECT id FROM captures WHERE idempotency_key=?", (key,)).fetchone()
        return self.get_capture(row["id"]) if row else None

    def create_manual_capture(
        self,
        capture_id: str,
        event_code: str,
        fields: dict,
        qualification: dict,
        method: str = "manual",
    ) -> dict:
        capture = self.create_capture(capture_id, event_code, method, f"{method}:{capture_id}", "", None)
        self.verify_capture(capture_id, fields)
        return self.qualify_capture(capture_id, qualification)

    def get_capture(self, capture_id: str) -> dict:
        with self.connect() as db:
            row = db.execute("SELECT * FROM captures WHERE id=?", (capture_id,)).fetchone()
            if not row:
                raise KeyError(capture_id)
            item = dict(row)
            item["extracted_fields"] = json.loads(item["extracted_fields"])
            item["field_confidences"] = json.loads(item["field_confidences"])
            item["field_sources"] = json.loads(item["field_sources"])
            item["conflicts"] = json.loads(item["conflicts"])
            item["manual_fields"] = json.loads(item["manual_fields"])
            item["qualification"] = json.loads(item["qualification"])
            return item

    def update_ocr(self, capture_id: str, front_text: str, back_text: str, parsed: dict, confidences: dict, sources: dict, conflicts: list) -> dict:
        now = utcnow()
        with self.connect() as db:
            db.execute("UPDATE captures SET raw_text_front=?,raw_text_back=?,extracted_fields=?,field_confidences=?,field_sources=?,conflicts=?,status='OCR Complete',verification_status='needs_verification',updated_at=? WHERE id=?",
                       (front_text, back_text, json.dumps(parsed), json.dumps(confidences), json.dumps(sources), json.dumps(conflicts), now, capture_id))
        return self.get_capture(capture_id)

    def verify_capture(self, capture_id: str, fields: dict) -> dict:
        now = utcnow()
        with self.connect() as db:
            db.execute("UPDATE captures SET manual_fields=?,verification_status='verified',status='Verified',updated_at=? WHERE id=?", (json.dumps(fields), now, capture_id))
        return self.get_capture(capture_id)

    def qualify_capture(self, capture_id: str, qualification: dict) -> dict:
        capture = self.get_capture(capture_id)
        fields = capture["manual_fields"]
        if not fields:
            fields = capture["extracted_fields"]
        full_name = fields.get("full_name") or " ".join(filter(None, [fields.get("first_name"), fields.get("last_name")])).strip()
        search_key = " ".join([full_name, fields.get("institution", ""), fields.get("email", "")]).lower()
        follow_up_at = qualification.get("follow_up_at")
        if qualification.get("next_action") == "Schedule Demo":
            follow_up_at = qualification.get("demo_date") or follow_up_at
        now = utcnow()
        with self.connect() as db:
            db.execute("UPDATE captures SET qualification=?,verification_status='qualified',status='Qualified',updated_at=? WHERE id=?", (json.dumps(qualification), now, capture_id))
            db.execute("""INSERT INTO leads(id,capture_id,full_name,institution,designation,email,mobile,city,state,country,address,priority,status,capture_method,captured_at,assigned_owner,follow_up_at,consent_status,search_key)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(capture_id) DO UPDATE SET full_name=excluded.full_name,institution=excluded.institution,designation=excluded.designation,email=excluded.email,mobile=excluded.mobile,city=excluded.city,state=excluded.state,country=excluded.country,address=excluded.address,priority=excluded.priority,status='Qualified',assigned_owner=excluded.assigned_owner,follow_up_at=excluded.follow_up_at,consent_status=excluded.consent_status,search_key=excluded.search_key""",
                       (str(uuid.uuid4()), capture_id, full_name or None, fields.get("institution"), fields.get("designation"), fields.get("email"), fields.get("mobile"), fields.get("city"), fields.get("state"), fields.get("country", "India"), fields.get("address"), qualification.get("lead_priority", "Cold"), "Qualified", capture["capture_method"], capture["created_at"], qualification.get("assigned_owner"), follow_up_at, qualification.get("consent_status", "unknown"), search_key))
            db.execute(
                "INSERT INTO app_sync_jobs(id,capture_id,provider,status,idempotency_key,created_at) "
                "VALUES(?,?,?,'Pending',?,?) "
                "ON CONFLICT(idempotency_key) DO UPDATE SET status='Pending',attempts=0,last_error=NULL,"
                "next_retry_at=NULL,completed_at=NULL",
                (str(uuid.uuid4()), capture_id, "zoho_crm", f"crm-flow:{capture_id}", now),
            )
        return self.get_capture(capture_id)

    def list_captures(self) -> list[dict]:
        with self.connect() as db:
            rows = db.execute("SELECT * FROM captures ORDER BY created_at DESC").fetchall()
        return [self.get_capture(row["id"]) for row in rows]

    def list_leads(self, query: str = "", priority: str = "") -> list[dict]:
        with self.connect() as db:
            conditions = []
            params: list[str] = []
            if query:
                conditions.append("search_key LIKE ?")
                params.append(f"%{query.lower()}%")
            if priority:
                conditions.append("priority=?")
                params.append(priority)
            sql = "SELECT * FROM leads"
            if conditions:
                sql += " WHERE " + " AND ".join(conditions)
            sql += " ORDER BY captured_at DESC"
            return [dict(row) for row in db.execute(sql, params).fetchall()]

    def list_tasks(self) -> list[dict]:
        with self.connect() as db:
            return [dict(row) for row in db.execute("SELECT * FROM tasks ORDER BY due_at ASC").fetchall()]

    def list_sync_jobs(self) -> list[dict]:
        with self.connect() as db:
            return [dict(row) for row in db.execute("SELECT * FROM app_sync_jobs ORDER BY created_at DESC").fetchall()]

    def set_crm_sync_job_status(self, capture_id: str, status: str, last_error: str | None = None) -> None:
        completed_at = utcnow() if status == "Completed" else None
        with self.connect() as db:
            db.execute(
                "UPDATE app_sync_jobs SET status=?,attempts=attempts+1,last_error=?,"
                "next_retry_at=NULL,completed_at=? WHERE capture_id=? AND provider='zoho_crm'",
                (status, last_error, completed_at, capture_id),
            )

    def requeue_crm_sync_job(self, capture_id: str) -> bool:
        with self.connect() as db:
            cursor = db.execute(
                "UPDATE app_sync_jobs SET status='Pending',last_error=NULL,next_retry_at=NULL,"
                "completed_at=NULL WHERE capture_id=? AND provider='zoho_crm' AND status IN ('Pending','Failed')",
                (capture_id,),
            )
            return cursor.rowcount > 0

    def dashboard(self) -> dict:
        with self.connect() as db:
            captures = db.execute("SELECT COUNT(*) FROM captures").fetchone()[0]
            qualified = db.execute("SELECT COUNT(*) FROM leads").fetchone()[0]
            hot = db.execute("SELECT COUNT(*) FROM leads WHERE priority='Hot'").fetchone()[0]
            pending = db.execute("SELECT COUNT(*) FROM app_sync_jobs WHERE status!='Completed'").fetchone()[0]
            cities = [dict(row) for row in db.execute("SELECT city,COUNT(*) AS count FROM leads WHERE city IS NOT NULL GROUP BY city ORDER BY count DESC LIMIT 10")]
            methods = [dict(row) for row in db.execute("SELECT capture_method,COUNT(*) AS count FROM captures GROUP BY capture_method")]
        return {"totals": {"captures": captures, "qualified": qualified, "hot": hot, "pending_jobs": pending}, "cities": cities, "capture_methods": methods}
