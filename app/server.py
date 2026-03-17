#!/usr/bin/env python3
import hashlib
import json
import os
import random
import secrets
from datetime import datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import psycopg2
import psycopg2.extras

ROOT = Path(__file__).resolve().parent
STATIC_DIR = ROOT / "static"
RATE_LIMIT_WINDOW_SECONDS = 60
RATE_LIMIT_MAX_REQUESTS = 20

DATABASE_URL = os.environ.get("DATABASE_URL", "")

ADMIN_USER = os.environ.get("ADMIN_USER", "admin")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "admin123")

WOMPI_PUBLIC_KEY = os.environ.get("WOMPI_PUBLIC_KEY", "")
WOMPI_INTEGRITY_SECRET = os.environ.get("WOMPI_INTEGRITY_SECRET", "")
WOMPI_EVENTS_SECRET = os.environ.get("WOMPI_EVENTS_SECRET", "")
CORS_ALLOW_ORIGINS = [o.strip() for o in os.environ.get("CORS_ALLOW_ORIGINS", "*").split(",") if o.strip()]

ADMIN_TOKENS = {}
RATE_LIMIT_BY_IP = {}


def hash_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def clamp_required_sales_pct(value) -> int:
    try:
        pct = int(value)
    except (TypeError, ValueError):
        pct = 70
    return max(1, min(100, pct))


def parse_sales_milestones(raw_value):
    if isinstance(raw_value, list):
        parts = raw_value
    else:
        text = str(raw_value or "20,40,60,80").replace(";", ",")
        parts = text.split(",")

    milestones = []
    for part in parts:
        digits = "".join(ch for ch in str(part) if ch.isdigit())
        if not digits:
            continue
        value = int(digits)
        if 1 <= value <= 100 and value not in milestones:
            milestones.append(value)

    milestones.sort()
    return milestones or [20, 40, 60, 80]


def format_sales_milestones(raw_value) -> str:
    return ",".join(str(n) for n in parse_sales_milestones(raw_value))


def maybe_award_milestone(cur, raffle_id: int, order_id: int, order_numbers):
    if not order_numbers:
        return None

    cur.execute("SELECT 1 FROM milestone_winners WHERE order_id=%s LIMIT 1", (order_id,))
    if cur.fetchone():
        return None

    cur.execute("SELECT total_numbers, sales_milestones FROM raffles WHERE id=%s", (raffle_id,))
    raffle = cur.fetchone()
    if not raffle:
        return None

    milestones = parse_sales_milestones(raffle.get("sales_milestones"))
    cur.execute("SELECT milestone_pct FROM milestone_winners WHERE raffle_id=%s", (raffle_id,))
    awarded = {int(row["milestone_pct"]) for row in cur.fetchall()}
    pending = [pct for pct in milestones if pct not in awarded]
    if not pending:
        return None

    cur.execute(
        """
        SELECT COUNT(*) AS sold_count
        FROM order_numbers n
        JOIN orders o ON o.id = n.order_id
        WHERE n.raffle_id=%s AND o.status IN ('paid_simulated', 'paid')
        """,
        (raffle_id,),
    )
    sold_count = int(cur.fetchone()["sold_count"] or 0)
    total_numbers = max(1, int(raffle["total_numbers"] or 1))
    current_pct = (sold_count * 100.0) / total_numbers

    eligible = [pct for pct in pending if current_pct >= pct]
    if not eligible:
        return None

    milestone_pct = min(eligible)
    winning_number = random.choice(order_numbers)
    label = f"Premio anticipado {milestone_pct}%"
    now = datetime.utcnow().isoformat()

    cur.execute(
        """
        INSERT INTO milestone_winners(raffle_id, milestone_pct, order_id, winning_number, label, created_at)
        VALUES(%s, %s, %s, %s, %s, %s)
        """,
        (raffle_id, milestone_pct, order_id, winning_number, label, now),
    )

    return {
        "milestone_pct": milestone_pct,
        "winning_number": winning_number,
        "label": label,
    }


def wompi_integrity(reference: str, amount_in_cents: int, currency: str) -> str:
    text = f"{reference}{amount_in_cents}{currency}{WOMPI_INTEGRITY_SECRET}"
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def build_pdf_receipt(lines):
    safe_lines = [line.replace('(', '').replace(')', '') for line in lines]
    parts = ["BT", "/F1 12 Tf", "50 750 Td"]
    for i, line in enumerate(safe_lines):
        if i == 0:
            parts.append(f"({line}) Tj")
        else:
            parts.append(f"0 -18 Td ({line}) Tj")
    parts.append("ET")
    stream = "\n".join(parts)
    stream_b = stream.encode("latin-1", errors="ignore")

    hdr   = b"%PDF-1.4\n"
    obj1  = b"1 0 obj<</Type /Catalog /Pages 2 0 R>>endobj\n"
    obj2  = b"2 0 obj<</Type /Pages /Kids [3 0 R] /Count 1>>endobj\n"
    obj3  = b"3 0 obj<</Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources<</Font<</F1 4 0 R>>>> /Contents 5 0 R>>endobj\n"
    obj4  = b"4 0 obj<</Type /Font /Subtype /Type1 /BaseFont /Helvetica>>endobj\n"
    obj5h = f"5 0 obj<</Length {len(stream_b)}>>stream\n".encode("latin-1")
    obj5f = b"\nendstream endobj\n"

    off1 = len(hdr)
    off2 = off1 + len(obj1)
    off3 = off2 + len(obj2)
    off4 = off3 + len(obj3)
    off5 = off4 + len(obj4)
    xref_pos = off5 + len(obj5h) + len(stream_b) + len(obj5f)

    xref = (
        f"xref\n0 6\n"
        f"0000000000 65535 f \n"
        f"{off1:010d} 00000 n \n"
        f"{off2:010d} 00000 n \n"
        f"{off3:010d} 00000 n \n"
        f"{off4:010d} 00000 n \n"
        f"{off5:010d} 00000 n \n"
        f"trailer<</Size 6 /Root 1 0 R>>\nstartxref\n{xref_pos}\n%%EOF"
    ).encode("latin-1")

    return hdr + obj1 + obj2 + obj3 + obj4 + obj5h + stream_b + obj5f + xref


def db():
    conn = psycopg2.connect(DATABASE_URL)
    conn.cursor_factory = psycopg2.extras.RealDictCursor
    return conn


def to_dict(row):
    return dict(row)


def init_db():
    conn = db()
    cur = conn.cursor()

    cur.execute("""
        CREATE TABLE IF NOT EXISTS admins (
            id SERIAL PRIMARY KEY,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            created_at TEXT NOT NULL
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS raffles (
            id SERIAL PRIMARY KEY,
            title TEXT NOT NULL,
            description TEXT,
            total_numbers INTEGER NOT NULL,
            ticket_price INTEGER NOT NULL,
            min_purchase INTEGER NOT NULL,
            required_sales_pct INTEGER NOT NULL DEFAULT 70,
            sales_milestones TEXT NOT NULL DEFAULT '20,40,60,80',
            status TEXT NOT NULL DEFAULT 'active',
            main_prize TEXT NOT NULL,
            image_url TEXT,
            updated_at TEXT NOT NULL
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS raffle_subprizes (
            id SERIAL PRIMARY KEY,
            raffle_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            description TEXT DEFAULT '',
            winner_rule TEXT DEFAULT 'editable_by_admin',
            created_at TEXT NOT NULL,
            FOREIGN KEY(raffle_id) REFERENCES raffles(id)
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS customers (
            id SERIAL PRIMARY KEY,
            document TEXT NOT NULL,
            first_name TEXT NOT NULL,
            last_name TEXT NOT NULL,
            email TEXT NOT NULL,
            phone TEXT NOT NULL,
            city TEXT DEFAULT '',
            UNIQUE(document, email)
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS orders (
            id SERIAL PRIMARY KEY,
            raffle_id INTEGER NOT NULL,
            customer_id INTEGER NOT NULL,
            total INTEGER NOT NULL,
            status TEXT NOT NULL DEFAULT 'paid_simulated',
            wompi_reference TEXT,
            created_at TEXT NOT NULL,
            FOREIGN KEY(raffle_id) REFERENCES raffles(id),
            FOREIGN KEY(customer_id) REFERENCES customers(id)
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS order_numbers (
            id SERIAL PRIMARY KEY,
            order_id INTEGER NOT NULL,
            raffle_id INTEGER NOT NULL,
            number TEXT NOT NULL,
            UNIQUE(raffle_id, number),
            FOREIGN KEY(order_id) REFERENCES orders(id)
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS draw_results (
            id SERIAL PRIMARY KEY,
            raffle_id INTEGER NOT NULL,
            winner_type TEXT NOT NULL,
            label TEXT NOT NULL,
            winning_number TEXT NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY(raffle_id) REFERENCES raffles(id)
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS milestone_winners (
            id SERIAL PRIMARY KEY,
            raffle_id INTEGER NOT NULL,
            milestone_pct INTEGER NOT NULL,
            order_id INTEGER NOT NULL UNIQUE,
            winning_number TEXT NOT NULL,
            label TEXT NOT NULL,
            created_at TEXT NOT NULL,
            UNIQUE(raffle_id, milestone_pct),
            FOREIGN KEY(raffle_id) REFERENCES raffles(id),
            FOREIGN KEY(order_id) REFERENCES orders(id)
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS audit_logs (
            id SERIAL PRIMARY KEY,
            raffle_id INTEGER,
            action TEXT NOT NULL,
            payload TEXT,
            created_at TEXT NOT NULL
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS site_settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL DEFAULT '',
            updated_at TEXT NOT NULL
        )
    """)

    default_ticker = json.dumps([
        "🎟 ¡Gran Rifa en curso! Compra tus tiquetes y participa para ganar",
        "🏆 Sorteo en vivo — Premios increíbles te esperan",
        "💳 Proceso de compra 100% seguro y confirmado con comprobante",
        "📱 Consulta tus tiquetes en la sección Mis Entradas en cualquier momento",
    ])
    _now = datetime.utcnow().isoformat()
    for _key, _val in [('whatsapp', ''), ('email', 'soporte@tuempresa.com'), ('ticker_items', default_ticker)]:
        cur.execute(
            "INSERT INTO site_settings(key, value, updated_at) VALUES(%s, %s, %s) ON CONFLICT (key) DO NOTHING",
            (_key, _val, _now)
        )

    # Migration: add wompi_reference if upgrading from older schema
    cur.execute("""
        DO $$ BEGIN
            ALTER TABLE orders ADD COLUMN wompi_reference TEXT;
        EXCEPTION WHEN duplicate_column THEN NULL;
        END $$
    """)

    cur.execute("""
        DO $$ BEGIN
            ALTER TABLE raffles ADD COLUMN required_sales_pct INTEGER NOT NULL DEFAULT 70;
        EXCEPTION WHEN duplicate_column THEN NULL;
        END $$
    """)

    cur.execute("""
        DO $$ BEGIN
            ALTER TABLE raffles ADD COLUMN sales_milestones TEXT NOT NULL DEFAULT '20,40,60,80';
        EXCEPTION WHEN duplicate_column THEN NULL;
        END $$
    """)

    cur.execute("UPDATE raffles SET required_sales_pct = LEAST(100, GREATEST(1, COALESCE(required_sales_pct, 70)))")
    cur.execute("UPDATE raffles SET sales_milestones = '20,40,60,80' WHERE sales_milestones IS NULL OR btrim(sales_milestones) = ''")

    cur.execute("SELECT COUNT(*) AS c FROM admins")
    if cur.fetchone()["c"] == 0:
        cur.execute(
            "INSERT INTO admins(username, password_hash, created_at) VALUES(%s, %s, %s)",
            (ADMIN_USER, hash_text(ADMIN_PASSWORD), datetime.utcnow().isoformat()),
        )

    cur.execute("SELECT COUNT(*) AS c FROM raffles")
    if cur.fetchone()["c"] == 0:
        now = datetime.utcnow().isoformat()
        cur.execute(
            """
            INSERT INTO raffles(title, description, total_numbers, ticket_price, min_purchase, required_sales_pct, sales_milestones, status, main_prize, image_url, updated_at)
            VALUES(%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id
            """,
            (
                "🎉 Gana $4.000.000",
                "Rifa principal",
                500,
                1000,
                5,
                70,
                "20,40,60,80",
                "active",
                "$4.000.000 COP",
                "",
                now,
            ),
        )
        raffle_id = cur.fetchone()["id"]
        cur.executemany(
            "INSERT INTO raffle_subprizes(raffle_id, name, description, winner_rule, created_at) VALUES(%s, %s, %s, %s, %s)",
            [
                (raffle_id, "Subpremio 1", "$250.000", "editable_by_admin", now),
                (raffle_id, "Subpremio 2", "$250.000", "editable_by_admin", now),
            ],
        )

    conn.commit()
    conn.close()


def is_rate_limited(client_ip: str) -> bool:
    now = datetime.utcnow()
    bucket = RATE_LIMIT_BY_IP.get(client_ip, [])
    valid = [t for t in bucket if (now - t).total_seconds() <= RATE_LIMIT_WINDOW_SECONDS]
    RATE_LIMIT_BY_IP[client_ip] = valid
    if len(valid) >= RATE_LIMIT_MAX_REQUESTS:
        return True
    valid.append(now)
    RATE_LIMIT_BY_IP[client_ip] = valid
    return False


class Handler(BaseHTTPRequestHandler):
    def _cors_origin(self):
        origin = self.headers.get("Origin", "")
        if not origin:
            return "*"
        if "*" in CORS_ALLOW_ORIGINS or origin in CORS_ALLOW_ORIGINS:
            return origin
        return ""

    def _send(self, status=200, body="", ctype="application/json"):
        data = body.encode() if isinstance(body, str) else body
        self.send_response(status)
        allowed_origin = self._cors_origin()
        if allowed_origin:
            self.send_header("Access-Control-Allow-Origin", allowed_origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS")
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _json(self, status=200, payload=None):
        self._send(status, json.dumps(payload if payload is not None else {}, ensure_ascii=False), "application/json; charset=utf-8")

    def _read_json(self):
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length) if length else b"{}"
        return json.loads(raw.decode("utf-8"))

    def _client_ip(self):
        return self.headers.get("X-Forwarded-For", self.client_address[0]).split(",")[0].strip()

    def _require_admin(self):
        auth = self.headers.get("Authorization", "")
        if not auth.startswith("Bearer "):
            return False
        token = auth.split(" ", 1)[1].strip()
        expires_at = ADMIN_TOKENS.get(token)
        if not expires_at:
            return False
        if datetime.utcnow() > expires_at:
            ADMIN_TOKENS.pop(token, None)
            return False
        return True

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path.startswith("/api/"):
            return self.api_get(path, parse_qs(parsed.query))

        if path == "/admin":
            path = "/admin.html"

        file_path = STATIC_DIR / ("index.html" if path == "/" else path.lstrip("/"))
        if file_path.exists() and file_path.is_file():
            ctype = "text/plain"
            if file_path.suffix == ".html":
                ctype = "text/html; charset=utf-8"
            elif file_path.suffix == ".css":
                ctype = "text/css"
            elif file_path.suffix == ".js":
                ctype = "application/javascript"
            elif file_path.suffix == ".svg":
                ctype = "image/svg+xml"
            elif file_path.suffix == ".png":
                ctype = "image/png"
            elif file_path.suffix in (".jpg", ".jpeg"):
                ctype = "image/jpeg"
            elif file_path.suffix == ".webp":
                ctype = "image/webp"
            elif file_path.suffix == ".ico":
                ctype = "image/x-icon"
            self._send(200, file_path.read_bytes(), ctype)
            return
        self._send(404, "Not found", "text/plain")

    def do_POST(self):
        path = urlparse(self.path).path
        if path.startswith("/api/"):
            return self.api_post(path)
        self._send(404, "Not found", "text/plain")

    def do_PATCH(self):
        path = urlparse(self.path).path
        if path.startswith("/api/"):
            return self.api_patch(path)
        self._send(404, "Not found", "text/plain")

    def do_OPTIONS(self):
        self._send(204, b"", "text/plain")

    def api_get(self, path, query):
        if path == "/api/health":
            return self._json(200, {"ok": True})

        conn = db()
        cur = conn.cursor()

        if path == "/api/settings":
            cur.execute("SELECT key, value FROM site_settings")
            rows = {r['key']: r['value'] for r in cur.fetchall()}
            conn.close()
            return self._json(200, {
                'whatsapp': rows.get('whatsapp', ''),
                'email': rows.get('email', ''),
                'ticker_items': json.loads(rows.get('ticker_items', '[]')),
            })

        if path == "/api/raffles":
            cur.execute("SELECT * FROM raffles ORDER BY id DESC")
            rows = [to_dict(r) for r in cur.fetchall()]
            conn.close()
            return self._json(200, rows)

        if path.startswith("/api/raffles/") and path.endswith("/numbers"):
            raffle_id = int(path.split("/")[3])
            cur.execute("SELECT number FROM order_numbers WHERE raffle_id = %s", (raffle_id,))
            sold = [r["number"] for r in cur.fetchall()]
            conn.close()
            return self._json(200, {"sold": sold})

        if path.startswith("/api/raffles/") and path.endswith("/subprizes"):
            raffle_id = int(path.split("/")[3])
            cur.execute("SELECT * FROM raffle_subprizes WHERE raffle_id=%s ORDER BY id", (raffle_id,))
            rows = [to_dict(r) for r in cur.fetchall()]
            conn.close()
            return self._json(200, rows)

        if path == "/api/tickets/query":
            if is_rate_limited(self._client_ip()):
                conn.close()
                return self._json(429, {"error": "Demasiadas consultas. Intenta nuevamente en 1 minuto."})
            key = (query.get("key", [""])[0]).strip().lower()
            cur.execute(
                """
                SELECT o.id AS order_id, o.total, o.created_at, c.email, c.document,
                STRING_AGG(onm.number, ',') AS numbers
                FROM orders o
                JOIN customers c ON c.id=o.customer_id
                JOIN order_numbers onm ON onm.order_id=o.id
                WHERE lower(c.email)=%s OR lower(c.document)=%s
                GROUP BY o.id, o.total, o.created_at, c.email, c.document
                ORDER BY o.id DESC
                """,
                (key, key),
            )
            rows = [to_dict(r) for r in cur.fetchall()]
            conn.close()
            return self._json(200, rows)

        if path.startswith("/api/raffles/") and path.endswith("/winners"):
            raffle_id = int(path.split("/")[3])
            cur.execute("SELECT * FROM draw_results WHERE raffle_id=%s ORDER BY id", (raffle_id,))
            results = cur.fetchall()
            winners = []
            for r in results:
                cur.execute(
                    """
                    SELECT c.first_name, c.last_name, c.city
                    FROM order_numbers n
                    JOIN orders o ON o.id=n.order_id
                    JOIN customers c ON c.id=o.customer_id
                    WHERE n.raffle_id=%s AND n.number=%s
                    LIMIT 1
                    """,
                    (raffle_id, r["winning_number"]),
                )
                owner = cur.fetchone()
                winners.append({
                    **to_dict(r),
                    "owner": f"{owner['first_name'][0]}*** {owner['last_name'][0]}*** - {owner['city'] or 'N/D'}" if owner else "Sin asignar",
                })

            cur.execute(
                """
                SELECT mw.milestone_pct, mw.winning_number, mw.label, c.first_name, c.last_name, c.city
                FROM milestone_winners mw
                JOIN orders o ON o.id = mw.order_id
                JOIN customers c ON c.id = o.customer_id
                WHERE mw.raffle_id=%s
                ORDER BY mw.milestone_pct
                """,
                (raffle_id,),
            )
            for row in cur.fetchall():
                winners.append({
                    "winner_type": "milestone",
                    "label": row["label"] or f"Premio anticipado {row['milestone_pct']}%",
                    "winning_number": row["winning_number"],
                    "owner": f"{row['first_name'][0]}*** {row['last_name'][0]}*** - {row['city'] or 'N/D'}",
                })

            conn.close()
            return self._json(200, winners)

        if path.startswith("/api/orders/") and path.endswith("/status"):
            order_id = int(path.split("/")[3])
            doc = (query.get("document", [""])[0]).strip()
            cur.execute(
                """
                SELECT o.id, o.status, o.total, o.wompi_reference
                FROM orders o
                JOIN customers c ON c.id=o.customer_id
                WHERE o.id=%s AND c.document=%s
                """,
                (order_id, doc),
            )
            row = cur.fetchone()
            if not row:
                conn.close()
                return self._json(404, {"error": "Orden no encontrada"})
            data = to_dict(row)
            cur.execute(
                "SELECT milestone_pct, winning_number, label FROM milestone_winners WHERE order_id=%s LIMIT 1",
                (order_id,),
            )
            milestone = cur.fetchone()
            if milestone:
                data["milestone_award"] = to_dict(milestone)
            conn.close()
            return self._json(200, data)

        if path.startswith("/api/orders/") and path.endswith("/receipt"):
            order_id = int(path.split("/")[3])
            document = (query.get("document", [""])[0]).strip()
            cur.execute(
                """
                SELECT o.id, o.total, o.created_at, c.document, c.first_name, c.last_name, r.title,
                STRING_AGG(n.number, ',') AS numbers
                FROM orders o
                JOIN customers c ON c.id=o.customer_id
                JOIN raffles r ON r.id=o.raffle_id
                JOIN order_numbers n ON n.order_id=o.id
                WHERE o.id=%s
                GROUP BY o.id, o.total, o.created_at, c.document, c.first_name, c.last_name, r.title
                """,
                (order_id,),
            )
            row = cur.fetchone()
            conn.close()
            if not row:
                return self._json(404, {"error": "Orden no encontrada"})
            if document != row["document"]:
                return self._json(403, {"error": "Documento inválido para descargar comprobante"})
            fecha = row['created_at'].replace('T', ' ')[:19]
            total_fmt = f"${row['total']:,}".replace(',', '.')
            pdf_bytes = build_pdf_receipt([
                "COMPROBANTE DE COMPRA",
                "================================",
                f"Orden N.: {row['id']}",
                f"Fecha:   {fecha}",
                f"Cliente: {row['first_name']} {row['last_name']}",
                f"Rifa:    {row['title']}",
                "",
                f"Numeros adquiridos:",
                f"{row['numbers']}",
                "",
                f"TOTAL: {total_fmt} COP",
                "================================",
                "Gracias por su compra!",
            ])
            return self._send(200, pdf_bytes, "application/pdf")

        if path == "/api/admin/orders":
            if not self._require_admin():
                conn.close()
                return self._json(401, {"error": "No autorizado"})
            cur.execute(
                """
                SELECT o.id, o.total, o.status, o.created_at, r.title AS raffle_title,
                c.first_name, c.last_name, c.email, c.document,
                STRING_AGG(n.number, ',') AS numbers
                FROM orders o
                JOIN raffles r ON r.id=o.raffle_id
                JOIN customers c ON c.id=o.customer_id
                JOIN order_numbers n ON n.order_id=o.id
                GROUP BY o.id, o.total, o.status, o.created_at, r.title,
                         c.first_name, c.last_name, c.email, c.document
                ORDER BY o.id DESC
                """
            )
            rows = [to_dict(r) for r in cur.fetchall()]
            conn.close()
            return self._json(200, rows)

        if path == "/api/admin/audit-logs":
            if not self._require_admin():
                conn.close()
                return self._json(401, {"error": "No autorizado"})
            cur.execute("SELECT * FROM audit_logs ORDER BY id DESC LIMIT 50")
            rows = [to_dict(r) for r in cur.fetchall()]
            conn.close()
            return self._json(200, rows)

        if path == "/api/admin/db/tables":
            if not self._require_admin():
                conn.close()
                return self._json(401, {"error": "No autorizado"})
            cur.execute("SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name")
            tables = [r['table_name'] for r in cur.fetchall()]
            conn.close()
            return self._json(200, tables)

        if path.startswith("/api/admin/db/table/"):
            if not self._require_admin():
                conn.close()
                return self._json(401, {"error": "No autorizado"})
            table = path[len("/api/admin/db/table/"):]
            cur.execute("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name=%s", (table,))
            if not cur.fetchone():
                conn.close()
                return self._json(404, {"error": "Tabla no existe"})
            page = max(1, int(query.get("page", ["1"])[0]))
            limit = min(int(query.get("limit", ["50"])[0]), 200)
            offset = (page - 1) * limit
            cur.execute("SELECT column_name FROM information_schema.columns WHERE table_name=%s AND table_schema='public' ORDER BY ordinal_position", (table,))
            columns = [r['column_name'] for r in cur.fetchall()]
            cur.execute(f'SELECT COUNT(*) AS c FROM "{table}"')
            total = cur.fetchone()['c']
            cur.execute(f'SELECT * FROM "{table}" ORDER BY 1 DESC LIMIT %s OFFSET %s', (limit, offset))
            rows = []
            for r in cur.fetchall():
                row = {}
                for k, v in dict(r).items():
                    row[k] = str(v) if v is not None else None
                rows.append(row)
            conn.close()
            return self._json(200, {"columns": columns, "rows": rows, "total": total, "page": page, "limit": limit})

        conn.close()
        return self._json(404, {"error": "Not found"})

    def api_post(self, path):
        conn = db()
        cur = conn.cursor()
        data = self._read_json()

        if path == "/api/admin/login":
            username = data.get("username", "")
            password = data.get("password", "")
            cur.execute(
                "SELECT * FROM admins WHERE username=%s AND password_hash=%s",
                (username, hash_text(password)),
            )
            admin = cur.fetchone()
            conn.close()
            if not admin:
                return self._json(401, {"error": "Credenciales inválidas"})
            token = secrets.token_urlsafe(24)
            ADMIN_TOKENS[token] = datetime.utcnow() + timedelta(hours=8)
            return self._json(200, {"token": token, "username": username})

        if path == "/api/orders":
            raffle_id = int(data["raffle_id"])
            numbers = [str(n).zfill(4) for n in data["numbers"]]
            cur.execute("SELECT * FROM raffles WHERE id=%s", (raffle_id,))
            raffle = cur.fetchone()
            if not raffle:
                conn.close()
                return self._json(400, {"error": "Rifa no existe"})
            if len(numbers) < raffle["min_purchase"]:
                conn.close()
                return self._json(400, {"error": f"Mínimo {raffle['min_purchase']}"})
            for n in numbers:
                if int(n) < 1 or int(n) > raffle["total_numbers"]:
                    conn.close()
                    return self._json(400, {"error": f"Número fuera de rango: {n}"})

            cur.execute("SELECT number FROM order_numbers WHERE raffle_id=%s", (raffle_id,))
            sold = {r["number"] for r in cur.fetchall()}
            conflicts = [n for n in numbers if n in sold]
            if conflicts:
                conn.close()
                return self._json(409, {"error": "Números no disponibles", "numbers": conflicts})

            customer_data = data["customer"]
            cur.execute(
                "SELECT id FROM customers WHERE document=%s AND email=%s",
                (customer_data["document"], customer_data["email"]),
            )
            c = cur.fetchone()
            if c:
                customer_id = c["id"]
            else:
                cur.execute(
                    "INSERT INTO customers(document, first_name, last_name, email, phone, city) VALUES(%s, %s, %s, %s, %s, %s) RETURNING id",
                    (
                        customer_data["document"], customer_data["first_name"], customer_data["last_name"],
                        customer_data["email"], customer_data["phone"], customer_data.get("city", "")
                    ),
                )
                customer_id = cur.fetchone()["id"]

            total = len(numbers) * raffle["ticket_price"]
            now = datetime.utcnow().isoformat()
            cur.execute(
                "INSERT INTO orders(raffle_id, customer_id, total, status, created_at) VALUES(%s, %s, %s, %s, %s) RETURNING id",
                (raffle_id, customer_id, total, "paid_simulated", now),
            )
            order_id = cur.fetchone()["id"]
            cur.executemany(
                "INSERT INTO order_numbers(order_id, raffle_id, number) VALUES(%s, %s, %s)",
                [(order_id, raffle_id, n) for n in numbers],
            )
            milestone_award = maybe_award_milestone(cur, raffle_id, order_id, numbers)
            conn.commit()
            conn.close()
            payload = {"order_id": order_id, "total": total, "numbers": numbers}
            if milestone_award:
                payload["milestone_award"] = milestone_award
            return self._json(201, payload)

        if path == "/api/payments/init":
            raffle_id = int(data["raffle_id"])
            quantity = int(data["quantity"])
            cur.execute("SELECT * FROM raffles WHERE id=%s", (raffle_id,))
            raffle = cur.fetchone()
            if not raffle:
                conn.close()
                return self._json(400, {"error": "Rifa no existe"})
            if raffle["status"] != "active":
                conn.close()
                return self._json(400, {"error": "Rifa no está activa"})
            if quantity < raffle["min_purchase"]:
                conn.close()
                return self._json(400, {"error": f"Mínimo {raffle['min_purchase']} tiquetes"})
            if quantity < 1:
                conn.close()
                return self._json(400, {"error": "Cantidad inválida"})

            cur.execute("SELECT number FROM order_numbers WHERE raffle_id=%s", (raffle_id,))
            sold_set = {r["number"] for r in cur.fetchall()}
            available = [str(i).zfill(4) for i in range(1, raffle["total_numbers"] + 1) if str(i).zfill(4) not in sold_set]
            if len(available) < quantity:
                conn.close()
                return self._json(400, {"error": f"No hay suficientes tiquetes disponibles. Solo quedan {len(available)}"})
            numbers = random.sample(available, quantity)

            customer_data = data["customer"]
            cur.execute(
                "SELECT id FROM customers WHERE document=%s AND email=%s",
                (customer_data["document"], customer_data["email"]),
            )
            c = cur.fetchone()
            if c:
                customer_id = c["id"]
            else:
                cur.execute(
                    "INSERT INTO customers(document, first_name, last_name, email, phone, city) VALUES(%s, %s, %s, %s, %s, %s) RETURNING id",
                    (
                        customer_data["document"], customer_data["first_name"], customer_data["last_name"],
                        customer_data["email"], customer_data["phone"], customer_data.get("city", "")
                    ),
                )
                customer_id = cur.fetchone()["id"]

            total = len(numbers) * raffle["ticket_price"]
            amount_in_cents = total * 100
            now = datetime.utcnow().isoformat()

            if WOMPI_PUBLIC_KEY and WOMPI_INTEGRITY_SECRET:
                cur.execute(
                    "INSERT INTO orders(raffle_id, customer_id, total, status, created_at) VALUES(%s, %s, %s, %s, %s) RETURNING id",
                    (raffle_id, customer_id, total, "pending_payment", now),
                )
                order_id = cur.fetchone()["id"]
                reference = f"RIFA-{order_id}"
                cur.execute("UPDATE orders SET wompi_reference=%s WHERE id=%s", (reference, order_id))
                cur.executemany(
                    "INSERT INTO order_numbers(order_id, raffle_id, number) VALUES(%s, %s, %s)",
                    [(order_id, raffle_id, n) for n in numbers],
                )
                conn.commit()
                conn.close()
                integrity = wompi_integrity(reference, amount_in_cents, "COP")
                return self._json(201, {
                    "mode": "wompi",
                    "order_id": order_id,
                    "reference": reference,
                    "amount_in_cents": amount_in_cents,
                    "public_key": WOMPI_PUBLIC_KEY,
                    "integrity": integrity,
                })
            else:
                cur.execute(
                    "INSERT INTO orders(raffle_id, customer_id, total, status, created_at) VALUES(%s, %s, %s, %s, %s) RETURNING id",
                    (raffle_id, customer_id, total, "paid_simulated", now),
                )
                order_id = cur.fetchone()["id"]
                cur.executemany(
                    "INSERT INTO order_numbers(order_id, raffle_id, number) VALUES(%s, %s, %s)",
                    [(order_id, raffle_id, n) for n in numbers],
                )
                milestone_award = maybe_award_milestone(cur, raffle_id, order_id, numbers)
                conn.commit()
                conn.close()
                payload = {"mode": "simulated", "order_id": order_id, "total": total, "numbers": numbers}
                if milestone_award:
                    payload["milestone_award"] = milestone_award
                return self._json(201, payload)

        if path == "/api/webhooks/wompi":
            if not WOMPI_EVENTS_SECRET:
                conn.close()
                return self._json(200, {"ok": True})

            top_sig = data.get("signature", {})
            props = top_sig.get("properties", [])
            received_checksum = top_sig.get("checksum", "")

            def _nested(obj, key):
                val = obj
                for part in key.split("."):
                    val = val.get(part, "") if isinstance(val, dict) else ""
                return str(val)

            concat = "".join(_nested(data, p) for p in props) + WOMPI_EVENTS_SECRET
            expected = hashlib.sha256(concat.encode("utf-8")).hexdigest()
            if not secrets.compare_digest(expected, received_checksum):
                conn.close()
                return self._json(401, {"error": "Firma inválida"})

            transaction = data.get("data", {}).get("transaction", {})
            status = transaction.get("status", "")
            reference = transaction.get("reference", "")
            transaction_id = transaction.get("id", "")

            cur.execute("SELECT * FROM orders WHERE wompi_reference=%s", (reference,))
            order = cur.fetchone()
            if not order:
                conn.close()
                return self._json(200, {"ok": True})

            now = datetime.utcnow().isoformat()
            if status == "APPROVED" and order["status"] == "pending_payment":
                cur.execute("UPDATE orders SET status='paid' WHERE id=%s", (order["id"],))
                cur.execute("SELECT number FROM order_numbers WHERE order_id=%s", (order["id"],))
                order_numbers = [r["number"] for r in cur.fetchall()]
                milestone_award = maybe_award_milestone(cur, order["raffle_id"], order["id"], order_numbers)
                approved_payload = {"reference": reference, "transaction_id": transaction_id}
                if milestone_award:
                    approved_payload["milestone_award"] = milestone_award
                cur.execute(
                    "INSERT INTO audit_logs(raffle_id, action, payload, created_at) VALUES(%s, %s, %s, %s)",
                    (order["raffle_id"], "payment_approved",
                     json.dumps(approved_payload), now),
                )
            elif status in ("DECLINED", "VOIDED", "ERROR") and order["status"] == "pending_payment":
                cur.execute("DELETE FROM order_numbers WHERE order_id=%s", (order["id"],))
                cur.execute("UPDATE orders SET status=%s WHERE id=%s", (f"failed_{status.lower()}", order["id"]))
                cur.execute(
                    "INSERT INTO audit_logs(raffle_id, action, payload, created_at) VALUES(%s, %s, %s, %s)",
                    (order["raffle_id"], "payment_failed",
                     json.dumps({"reference": reference, "status": status}), now),
                )
            conn.commit()
            conn.close()
            return self._json(200, {"ok": True})

        if path.startswith("/api/admin/") and path != "/api/admin/login" and not self._require_admin():
            conn.close()
            return self._json(401, {"error": "No autorizado"})

        if path == "/api/admin/raffles":
            now = datetime.utcnow().isoformat()
            required_sales_pct = clamp_required_sales_pct(data.get("required_sales_pct", 70))
            sales_milestones = format_sales_milestones(data.get("sales_milestones", "20,40,60,80"))
            cur.execute(
                """
                INSERT INTO raffles(title, description, total_numbers, ticket_price, min_purchase, required_sales_pct, sales_milestones, status, main_prize, image_url, updated_at)
                VALUES(%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id
                """,
                (
                    data["title"], data.get("description", ""), int(data["total_numbers"]), int(data["ticket_price"]),
                    int(data.get("min_purchase", 1)), required_sales_pct, sales_milestones, data.get("status", "active"),
                    data.get("main_prize", ""), data.get("image_url", ""), now
                )
            )
            rid = cur.fetchone()["id"]
            cur.execute(
                "INSERT INTO audit_logs(raffle_id, action, payload, created_at) VALUES(%s, %s, %s, %s)",
                (rid, "create_raffle", json.dumps(data), now)
            )
            conn.commit()
            conn.close()
            return self._json(201, {"id": rid})

        if path.startswith("/api/admin/raffles/") and path.endswith("/reset"):
            raffle_id = int(path.split("/")[4])
            if str(data.get("confirm", "")).strip().upper() != "RESET":
                conn.close()
                return self._json(400, {"error": "Confirmacion invalida. Debes enviar confirm=RESET"})

            cur.execute("SELECT id, title FROM raffles WHERE id=%s", (raffle_id,))
            raffle = cur.fetchone()
            if not raffle:
                conn.close()
                return self._json(404, {"error": "Rifa no existe"})

            now = datetime.utcnow().isoformat()
            cur.execute("DELETE FROM raffle_subprizes WHERE raffle_id=%s", (raffle_id,))
            cur.execute("DELETE FROM draw_results WHERE raffle_id=%s", (raffle_id,))
            cur.execute("DELETE FROM milestone_winners WHERE raffle_id=%s", (raffle_id,))
            cur.execute("DELETE FROM order_numbers WHERE raffle_id=%s", (raffle_id,))
            cur.execute("DELETE FROM orders WHERE raffle_id=%s", (raffle_id,))
            cur.execute("DELETE FROM audit_logs WHERE raffle_id=%s", (raffle_id,))
            cur.execute("DELETE FROM customers c WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.id)")
            cur.execute("UPDATE raffles SET status='active', updated_at=%s WHERE id=%s", (now, raffle_id))
            cur.execute(
                "INSERT INTO audit_logs(raffle_id, action, payload, created_at) VALUES(%s, %s, %s, %s)",
                (raffle_id, "reset_raffle", json.dumps({"title": raffle["title"]}), now)
            )
            conn.commit()
            conn.close()
            return self._json(200, {"ok": True, "raffle_id": raffle_id})

        if path.startswith("/api/admin/raffles/") and path.endswith("/subprizes"):
            raffle_id = int(path.split("/")[4])
            subprizes = data.get("subprizes", [])
            now = datetime.utcnow().isoformat()
            cur.execute("DELETE FROM raffle_subprizes WHERE raffle_id=%s", (raffle_id,))
            for item in subprizes:
                cur.execute(
                    "INSERT INTO raffle_subprizes(raffle_id, name, description, winner_rule, created_at) VALUES(%s, %s, %s, %s, %s)",
                    (raffle_id, item.get("name", "Subpremio"), item.get("description", ""), item.get("winner_rule", "editable_by_admin"), now),
                )
            cur.execute(
                "INSERT INTO audit_logs(raffle_id, action, payload, created_at) VALUES(%s, %s, %s, %s)",
                (raffle_id, "set_subprizes", json.dumps(data), now)
            )
            conn.commit()
            conn.close()
            return self._json(200, {"ok": True})

        if path.startswith("/api/admin/raffles/") and path.endswith("/draw-results"):
            raffle_id = int(path.split("/")[4])
            results = data.get("results", [])
            now = datetime.utcnow().isoformat()

            if not isinstance(results, list) or not results:
                conn.close()
                return self._json(400, {"error": "Debes enviar al menos un ganador."})

            cur.execute("SELECT total_numbers FROM raffles WHERE id=%s", (raffle_id,))
            raffle = cur.fetchone()
            if not raffle:
                conn.close()
                return self._json(404, {"error": "Rifa no existe"})

            validated_results = []
            for item in results:
                raw_number = str(item.get("winning_number", "")).strip()
                digits = "".join(ch for ch in raw_number if ch.isdigit())
                if not digits:
                    continue
                numeric = int(digits)
                if numeric < 1 or numeric > int(raffle["total_numbers"]):
                    conn.close()
                    return self._json(400, {"error": f"Número ganador fuera de rango: {raw_number}"})
                validated_results.append({
                    "winner_type": item.get("winner_type", "subprize"),
                    "label": item.get("label", "Premio"),
                    "winning_number": str(numeric).zfill(4),
                })

            if not validated_results:
                conn.close()
                return self._json(400, {"error": "No se enviaron números ganadores válidos."})

            if not any(r["winner_type"] == "main" for r in validated_results):
                conn.close()
                return self._json(400, {"error": "Debes incluir un ganador principal."})

            cur.execute("DELETE FROM draw_results WHERE raffle_id=%s", (raffle_id,))
            for item in validated_results:
                cur.execute(
                    "INSERT INTO draw_results(raffle_id, winner_type, label, winning_number, created_at) VALUES(%s, %s, %s, %s, %s)",
                    (raffle_id, item["winner_type"], item["label"], item["winning_number"], now),
                )
            cur.execute(
                "INSERT INTO audit_logs(raffle_id, action, payload, created_at) VALUES(%s, %s, %s, %s)",
                (raffle_id, "set_winners", json.dumps({"results": validated_results}), now)
            )
            conn.commit()
            conn.close()
            return self._json(200, {"ok": True})

        conn.close()
        return self._json(404, {"error": "Not found"})

    def api_patch(self, path):
        if path.startswith("/api/admin/") and not self._require_admin():
            return self._json(401, {"error": "No autorizado"})

        conn = db()
        cur = conn.cursor()
        data = self._read_json()

        if path == "/api/admin/db/query":
            if not self._require_admin():
                conn.close()
                return self._json(401, {"error": "No autorizado"})
            sql = (data.get("sql") or "").strip()
            if not sql:
                conn.close()
                return self._json(400, {"error": "SQL vacío"})
            try:
                cur.execute(sql)
                if cur.description:
                    cols = [d.name for d in cur.description]
                    rows = []
                    for r in cur.fetchall():
                        row = {}
                        for k, v in dict(r).items():
                            row[k] = str(v) if v is not None else None
                        rows.append(row)
                    conn.commit()
                    conn.close()
                    return self._json(200, {"type": "select", "columns": cols, "rows": rows})
                else:
                    cnt = cur.rowcount
                    conn.commit()
                    conn.close()
                    return self._json(200, {"type": "modify", "rowcount": cnt})
            except Exception as exc:
                conn.rollback()
                conn.close()
                return self._json(400, {"error": str(exc)})

        if path == "/api/admin/settings":
            now = datetime.utcnow().isoformat()
            for key in ('whatsapp', 'email'):
                if key in data:
                    val = str(data[key])
                    cur.execute(
                        "INSERT INTO site_settings(key, value, updated_at) VALUES(%s,%s,%s) ON CONFLICT(key) DO UPDATE SET value=%s, updated_at=%s",
                        (key, val, now, val, now)
                    )
            if 'ticker_items' in data:
                val = json.dumps(data['ticker_items'])
                cur.execute(
                    "INSERT INTO site_settings(key, value, updated_at) VALUES(%s,%s,%s) ON CONFLICT(key) DO UPDATE SET value=%s, updated_at=%s",
                    ('ticker_items', val, now, val, now)
                )
            conn.commit()
            conn.close()
            return self._json(200, {'ok': True})

        if path.startswith("/api/admin/raffles/"):
            raffle_id = int(path.split("/")[4])
            allowed = ["title", "description", "total_numbers", "ticket_price", "min_purchase", "required_sales_pct", "sales_milestones", "main_prize", "image_url", "status"]
            int_fields = {"total_numbers", "ticket_price", "min_purchase", "required_sales_pct"}
            sets, vals = [], []
            for k in allowed:
                if k in data:
                    value = data[k]
                    if k in int_fields:
                        try:
                            value = int(value)
                        except (TypeError, ValueError):
                            conn.close()
                            return self._json(400, {"error": f"Valor inválido para {k}"})
                        if k == "required_sales_pct":
                            value = clamp_required_sales_pct(value)
                    if k == "sales_milestones":
                        value = format_sales_milestones(value)
                    sets.append(f"{k}=%s")
                    vals.append(value)
            if not sets:
                conn.close()
                return self._json(400, {"error": "Sin cambios"})
            sets.append("updated_at=%s")
            vals.append(datetime.utcnow().isoformat())
            vals.append(raffle_id)
            cur.execute(f"UPDATE raffles SET {', '.join(sets)} WHERE id=%s", vals)
            cur.execute(
                "INSERT INTO audit_logs(raffle_id, action, payload, created_at) VALUES(%s, %s, %s, %s)",
                (raffle_id, "update_raffle", json.dumps(data), datetime.utcnow().isoformat())
            )
            conn.commit()
            conn.close()
            return self._json(200, {"ok": True})

        conn.close()
        return self._json(404, {"error": "Not found"})


if __name__ == "__main__":
    import threading, time

    def init_db_with_retry():
        for attempt in range(1, 11):
            try:
                init_db()
                print("Base de datos inicializada correctamente.")
                return
            except Exception as e:
                print(f"DB init intento {attempt}/10 falló: {e}")
                time.sleep(attempt * 2)
        print("No se pudo inicializar la base de datos tras 10 intentos.")

    threading.Thread(target=init_db_with_retry, daemon=True).start()

    port = int(os.environ.get("PORT", "8080"))
    print(f"Servidor en http://localhost:{port}")
    print(f"Admin: {ADMIN_USER}")
    ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()
