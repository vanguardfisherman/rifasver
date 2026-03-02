#!/usr/bin/env python3
import hashlib
import json
import os
import secrets
import sqlite3
from datetime import datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parent
DB_PATH = ROOT / "data" / "rifas.db"
STATIC_DIR = ROOT / "static"
RATE_LIMIT_WINDOW_SECONDS = 60
RATE_LIMIT_MAX_REQUESTS = 20

ADMIN_USER = os.environ.get("ADMIN_USER", "admin")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "admin123")

ADMIN_TOKENS = {}
RATE_LIMIT_BY_IP = {}


def hash_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def to_dict(row):
    return {k: row[k] for k in row.keys()}


def init_db():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = db()
    cur = conn.cursor()
    cur.executescript(
        """
        CREATE TABLE IF NOT EXISTS admins (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS raffles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            description TEXT,
            total_numbers INTEGER NOT NULL,
            ticket_price INTEGER NOT NULL,
            min_purchase INTEGER NOT NULL,
            status TEXT NOT NULL DEFAULT 'active',
            main_prize TEXT NOT NULL,
            image_url TEXT,
            updated_at TEXT NOT NULL
        );

          CREATE TABLE IF NOT EXISTS raffle_subprizes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            raffle_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            description TEXT DEFAULT '',
            winner_rule TEXT DEFAULT 'editable_by_admin',
            created_at TEXT NOT NULL,
            FOREIGN KEY(raffle_id) REFERENCES raffles(id)
        );

        CREATE TABLE IF NOT EXISTS customers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            document TEXT NOT NULL,
            first_name TEXT NOT NULL,
            last_name TEXT NOT NULL,
            email TEXT NOT NULL,
            phone TEXT NOT NULL,
            city TEXT DEFAULT '',
            UNIQUE(document, email)
        );

        CREATE TABLE IF NOT EXISTS orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            raffle_id INTEGER NOT NULL,
            customer_id INTEGER NOT NULL,
            total INTEGER NOT NULL,
            status TEXT NOT NULL DEFAULT 'paid_simulated',
            created_at TEXT NOT NULL,
            FOREIGN KEY(raffle_id) REFERENCES raffles(id),
            FOREIGN KEY(customer_id) REFERENCES customers(id)
        );

        CREATE TABLE IF NOT EXISTS order_numbers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_id INTEGER NOT NULL,
            raffle_id INTEGER NOT NULL,
            number TEXT NOT NULL,
            UNIQUE(raffle_id, number),
            FOREIGN KEY(order_id) REFERENCES orders(id)
        );

        CREATE TABLE IF NOT EXISTS draw_results (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            raffle_id INTEGER NOT NULL,
            winner_type TEXT NOT NULL,
            label TEXT NOT NULL,
            winning_number TEXT NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY(raffle_id) REFERENCES raffles(id)
        );

        CREATE TABLE IF NOT EXISTS audit_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            raffle_id INTEGER,
            action TEXT NOT NULL,
            payload TEXT,
            created_at TEXT NOT NULL
        );
        """
    )

    if cur.execute("SELECT COUNT(*) c FROM admins").fetchone()["c"] == 0:
        cur.execute(
            "INSERT INTO admins(username,password_hash,created_at) VALUES(?,?,?)",
            (ADMIN_USER, hash_text(ADMIN_PASSWORD), datetime.utcnow().isoformat()),
        )

    if cur.execute("SELECT COUNT(*) c FROM raffles").fetchone()["c"] == 0:
        now = datetime.utcnow().isoformat()
        cur.execute(
            """
            INSERT INTO raffles(title, description, total_numbers, ticket_price, min_purchase, status, main_prize, image_url, updated_at)
            VALUES(?,?,?,?,?,?,?,?,?)
            """,
            (
                "🎉 Gana $4.000.000",
                "Rifa principal",
                500,
                1000,
                5,
                "active",
                "$4.000.000 COP",
                "",
                now,
            ),
        )
        raffle_id = cur.lastrowid
        cur.executemany(
            "INSERT INTO raffle_subprizes(raffle_id,name,description,winner_rule,created_at) VALUES(?,?,?,?,?)",
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
    def _send(self, status=200, body="", ctype="application/json"):
        data = body.encode() if isinstance(body, str) else body
        self.send_response(status)
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

    def api_get(self, path, query):
        conn = db()
        cur = conn.cursor()

        if path == "/api/health":
            return self._json(200, {"ok": True})

        if path == "/api/raffles":
            rows = [to_dict(r) for r in cur.execute("SELECT * FROM raffles ORDER BY id DESC")]
            return self._json(200, rows)

        if path.startswith("/api/raffles/") and path.endswith("/numbers"):
            raffle_id = int(path.split("/")[3])
            sold = [r["number"] for r in cur.execute("SELECT number FROM order_numbers WHERE raffle_id = ?", (raffle_id,))]
            return self._json(200, {"sold": sold})

        if path.startswith("/api/raffles/") and path.endswith("/subprizes"):
            raffle_id = int(path.split("/")[3])
            rows = [to_dict(r) for r in cur.execute("SELECT * FROM raffle_subprizes WHERE raffle_id=? ORDER BY id", (raffle_id,))]
            return self._json(200, rows)

        if path == "/api/tickets/query":
            if is_rate_limited(self._client_ip()):
                return self._json(429, {"error": "Demasiadas consultas. Intenta nuevamente en 1 minuto."})
            key = (query.get("key", [""])[0]).strip().lower()
            rows = cur.execute(
                """
                SELECT o.id order_id, o.total, o.created_at, c.email, c.document,
                GROUP_CONCAT(onm.number) numbers
                FROM orders o
                JOIN customers c ON c.id=o.customer_id
                JOIN order_numbers onm ON onm.order_id=o.id
                WHERE lower(c.email)=? OR lower(c.document)=?
                GROUP BY o.id ORDER BY o.id DESC
                """,
                (key, key),
            ).fetchall()
            return self._json(200, [to_dict(r) for r in rows])

        if path.startswith("/api/raffles/") and path.endswith("/winners"):
            raffle_id = int(path.split("/")[3])
            rows = cur.execute("SELECT * FROM draw_results WHERE raffle_id=? ORDER BY id", (raffle_id,)).fetchall()
            winners = []
            for r in rows:
                owner = cur.execute(
                    """
                    SELECT c.first_name,c.last_name,c.city
                    FROM order_numbers n
                    JOIN orders o ON o.id=n.order_id
                    JOIN customers c ON c.id=o.customer_id
                    WHERE n.raffle_id=? AND n.number=?
                    LIMIT 1
                    """,
                    (raffle_id, r["winning_number"]),
                ).fetchone()
                winners.append({
                    **to_dict(r),
                    "owner": f"{owner['first_name'][0]}*** {owner['last_name'][0]}*** • {owner['city'] or 'N/D'}" if owner else "Sin asignar",
                })
            return self._json(200, winners)

        if path == "/api/admin/orders":
            if not self._require_admin():
                return self._json(401, {"error": "No autorizado"})
            rows = cur.execute(
                """
                SELECT o.id, o.total, o.status, o.created_at, r.title raffle_title,
                c.first_name, c.last_name, c.email, c.document, GROUP_CONCAT(n.number) numbers
                FROM orders o
                JOIN raffles r ON r.id=o.raffle_id
                JOIN customers c ON c.id=o.customer_id
                JOIN order_numbers n ON n.order_id=o.id
                GROUP BY o.id ORDER BY o.id DESC
                """
            ).fetchall()
            return self._json(200, [to_dict(r) for r in rows])

        if path == "/api/admin/audit-logs":
            if not self._require_admin():
                return self._json(401, {"error": "No autorizado"})
            rows = cur.execute("SELECT * FROM audit_logs ORDER BY id DESC LIMIT 50").fetchall()
            return self._json(200, [to_dict(r) for r in rows])

        return self._json(404, {"error": "Not found"})

    def api_post(self, path):
        conn = db()
        cur = conn.cursor()
        data = self._read_json()

        if path == "/api/admin/login":
            username = data.get("username", "")
            password = data.get("password", "")
            admin = cur.execute(
                "SELECT * FROM admins WHERE username=? AND password_hash=?",
                (username, hash_text(password)),
            ).fetchone()
            if not admin:
                return self._json(401, {"error": "Credenciales inválidas"})
            token = secrets.token_urlsafe(24)
            ADMIN_TOKENS[token] = datetime.utcnow() + timedelta(hours=8)
            return self._json(200, {"token": token, "username": username})

        if path == "/api/orders":
            raffle_id = int(data["raffle_id"])
            numbers = [str(n).zfill(4) for n in data["numbers"]]
            raffle = cur.execute("SELECT * FROM raffles WHERE id=?", (raffle_id,)).fetchone()
            if not raffle:
                return self._json(400, {"error": "Rifa no existe"})
            if len(numbers) < raffle["min_purchase"]:
                return self._json(400, {"error": f"Mínimo {raffle['min_purchase']}"})
            for n in numbers:
                if int(n) < 1 or int(n) > raffle["total_numbers"]:
                    return self._json(400, {"error": f"Número fuera de rango: {n}"})

            sold = {r["number"] for r in cur.execute("SELECT number FROM order_numbers WHERE raffle_id=?", (raffle_id,))}
            conflicts = [n for n in numbers if n in sold]
            if conflicts:
                return self._json(409, {"error": "Números no disponibles", "numbers": conflicts})

            customer_data = data["customer"]
            c = cur.execute(
                "SELECT id FROM customers WHERE document=? AND email=?",
                (customer_data["document"], customer_data["email"]),
            ).fetchone()
            if c:
                customer_id = c["id"]
            else:
                cur.execute(
                    "INSERT INTO customers(document,first_name,last_name,email,phone,city) VALUES(?,?,?,?,?,?)",
                    (
                        customer_data["document"], customer_data["first_name"], customer_data["last_name"],
                        customer_data["email"], customer_data["phone"], customer_data.get("city", "")
                    ),
                )
                customer_id = cur.lastrowid

            total = len(numbers) * raffle["ticket_price"]
            now = datetime.utcnow().isoformat()
            cur.execute(
                "INSERT INTO orders(raffle_id,customer_id,total,status,created_at) VALUES(?,?,?,?,?)",
                (raffle_id, customer_id, total, "paid_simulated", now),
            )
            order_id = cur.lastrowid
            cur.executemany(
                "INSERT INTO order_numbers(order_id,raffle_id,number) VALUES(?,?,?)",
                [(order_id, raffle_id, n) for n in numbers],
            )
            conn.commit()
            return self._json(201, {"order_id": order_id, "total": total, "numbers": numbers})

        if path.startswith("/api/admin/") and path != "/api/admin/login" and not self._require_admin():
            return self._json(401, {"error": "No autorizado"})

        if path == "/api/admin/raffles":
            now = datetime.utcnow().isoformat()
            cur.execute(
                """
                INSERT INTO raffles(title,description,total_numbers,ticket_price,min_purchase,status,main_prize,image_url,updated_at)
                VALUES(?,?,?,?,?,?,?,?,?)
                """,
                (
                    data["title"], data.get("description", ""), int(data["total_numbers"]), int(data["ticket_price"]),
                    int(data.get("min_purchase", 1)), data.get("status", "active"), data.get("main_prize", ""), data.get("image_url", ""), now
                )
            )
            rid = cur.lastrowid
            cur.execute("INSERT INTO audit_logs(raffle_id,action,payload,created_at) VALUES(?,?,?,?)", (rid, "create_raffle", json.dumps(data), now))
            conn.commit()
            return self._json(201, {"id": rid})

        if path.startswith("/api/admin/raffles/") and path.endswith("/subprizes"):
            raffle_id = int(path.split("/")[4])
            subprizes = data.get("subprizes", [])
            now = datetime.utcnow().isoformat()
            cur.execute("DELETE FROM raffle_subprizes WHERE raffle_id=?", (raffle_id,))
            for item in subprizes:
                cur.execute(
                    "INSERT INTO raffle_subprizes(raffle_id,name,description,winner_rule,created_at) VALUES(?,?,?,?,?)",
                    (raffle_id, item.get("name", "Subpremio"), item.get("description", ""), item.get("winner_rule", "editable_by_admin"), now),
                )
            cur.execute("INSERT INTO audit_logs(raffle_id,action,payload,created_at) VALUES(?,?,?,?)", (raffle_id, "set_subprizes", json.dumps(data), now))
            conn.commit()
            return self._json(200, {"ok": True})

        if path.startswith("/api/admin/raffles/") and path.endswith("/draw-results"):
            raffle_id = int(path.split("/")[4])
            results = data.get("results", [])
            now = datetime.utcnow().isoformat()
            cur.execute("DELETE FROM draw_results WHERE raffle_id=?", (raffle_id,))
            for item in results:
                num = str(item["winning_number"]).zfill(4)
                cur.execute(
                    "INSERT INTO draw_results(raffle_id,winner_type,label,winning_number,created_at) VALUES(?,?,?,?,?)",
                    (raffle_id, item.get("winner_type", "subprize"), item.get("label", "Premio"), num, now),
                )
            cur.execute("INSERT INTO audit_logs(raffle_id,action,payload,created_at) VALUES(?,?,?,?)", (raffle_id, "set_winners", json.dumps(data), now))
            conn.commit()
            return self._json(200, {"ok": True})

        return self._json(404, {"error": "Not found"})

    def api_patch(self, path):
        if path.startswith("/api/admin/") and not self._require_admin():
            return self._json(401, {"error": "No autorizado"})

        conn = db()
        cur = conn.cursor()
        data = self._read_json()

        if path.startswith("/api/admin/raffles/"):
            raffle_id = int(path.split("/")[4])
            allowed = ["title", "description", "total_numbers", "ticket_price", "min_purchase", "main_prize", "image_url", "status"]
            sets, vals = [], []
            for k in allowed:
                if k in data:
                    sets.append(f"{k}=?")
                    vals.append(data[k])
            if not sets:
                return self._json(400, {"error": "Sin cambios"})
            sets.append("updated_at=?")
            vals.append(datetime.utcnow().isoformat())
            vals.append(raffle_id)
            cur.execute(f"UPDATE raffles SET {', '.join(sets)} WHERE id=?", vals)
            cur.execute("INSERT INTO audit_logs(raffle_id,action,payload,created_at) VALUES(?,?,?,?)", (raffle_id, "update_raffle", json.dumps(data), datetime.utcnow().isoformat()))
            conn.commit()
            return self._json(200, {"ok": True})

        return self._json(404, {"error": "Not found"})


if __name__ == "__main__":
    init_db()
    port = int(os.environ.get("PORT", "8080"))
    print(f"Servidor en http://localhost:{port}")
    print(f"Admin por defecto => usuario: {ADMIN_USER} | clave: {ADMIN_PASSWORD}")
    ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()
