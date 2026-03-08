"""
app.py — Smart Inventory & Expiration Manager
Flask REST API sunucusu.
Tüm endpoint'ler JSON döndürür; frontend Fetch API ile iletişim kurar.
"""

import csv
import io
import os
import requests as http_requests
from datetime import datetime

from flask import Flask, jsonify, request, render_template, abort
from flask_cors import CORS
from dotenv import load_dotenv

from models import (
    get_connection, init_db, row_to_dict,
    log_action, calculate_status
)

# .env dosyasını yükle (varsa; yoksa ortam değişkenlerini kullan)
load_dotenv()


# ─────────────────────────────────────────────
# Uygulama kurulumu
# ─────────────────────────────────────────────

app = Flask(__name__)
CORS(app)  # Geliştirme aşamasında tüm kaynaklara izin ver

# Telegram ayarları (.env veya ortam değişkeninden alınır)
TELEGRAM_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_CHAT_ID = os.getenv("TELEGRAM_CHAT_ID", "")


# ─────────────────────────────────────────────
# Yardımcı fonksiyonlar
# ─────────────────────────────────────────────

def success(data=None, message="OK", code=200):
    return jsonify({"success": True, "message": message, "data": data}), code


def error(message="Hata oluştu", code=400):
    return jsonify({"success": False, "message": message}), code


# ─────────────────────────────────────────────
# Ana sayfa
# ─────────────────────────────────────────────

@app.route("/")
def index():
    return render_template("index.html")


# ─────────────────────────────────────────────
# /api/stats  — Dashboard istatistikleri
# ─────────────────────────────────────────────

@app.route("/api/stats")
def get_stats():
    conn = get_connection()
    try:
        total        = conn.execute("SELECT COUNT(*) FROM products WHERE is_active=1").fetchone()[0]
        low_stock    = conn.execute("SELECT COUNT(*) FROM products WHERE is_active=1 AND stock<=5").fetchone()[0]
        categories   = conn.execute("SELECT COUNT(DISTINCT category) FROM products WHERE is_active=1").fetchone()[0]

        # Kritik ve tarihi geçmiş ürünleri Python tarafında hesapla
        rows = conn.execute("SELECT expiry_date FROM products WHERE is_active=1").fetchall()
        critical = sum(1 for r in rows if calculate_status(r["expiry_date"]) in ("Kritik", "Tarihi Geçti"))

        return success({
            "total": total,
            "critical": critical,
            "low_stock": low_stock,
            "categories": categories
        })
    finally:
        conn.close()


# ─────────────────────────────────────────────
# /api/products  — Ürün CRUD
# ─────────────────────────────────────────────

@app.route("/api/products", methods=["GET"])
def list_products():
    """Aktif ürünlerin listesini döndürür. ?category=X ile filtreleme."""
    category = request.args.get("category")
    search   = request.args.get("search", "").strip()

    conn = get_connection()
    try:
        query  = "SELECT * FROM products WHERE is_active=1"
        params = []

        if category:
            query += " AND category=?"
            params.append(category)

        if search:
            query += " AND (name LIKE ? OR barcode LIKE ?)"
            params.extend([f"%{search}%", f"%{search}%"])

        query += " ORDER BY name ASC"

        rows = conn.execute(query, params).fetchall()
        return success([row_to_dict(r) for r in rows])
    finally:
        conn.close()


@app.route("/api/products", methods=["POST"])
def create_product():
    """Yeni ürün oluşturur."""
    data = request.get_json(silent=True) or {}

    name = (data.get("name") or "").strip()
    if not name:
        return error("Ürün adı zorunludur.")

    stock = int(data.get("stock", 0))
    if stock < 0:
        return error("Stok miktarı negatif olamaz.")

    expiry_date = data.get("expiry_date") or None
    category    = (data.get("category") or "Diğer").strip()
    barcode     = (data.get("barcode") or "").strip() or None
    image_url   = (data.get("image_url") or "").strip() or None
    status      = calculate_status(expiry_date)

    conn = get_connection()
    try:
        with conn:
            cur = conn.execute(
                """INSERT INTO products (barcode, name, stock, expiry_date, category, status, image_url)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (barcode, name, stock, expiry_date, category, status, image_url)
            )
            product_id = cur.lastrowid
            log_action(conn, product_id, "CREATE", stock, "Ürün oluşturuldu")

        product = row_to_dict(conn.execute("SELECT * FROM products WHERE id=?", (product_id,)).fetchone())
        return success(product, "Ürün başarıyla oluşturuldu.", 201)
    finally:
        conn.close()


@app.route("/api/products/<int:product_id>", methods=["GET"])
def get_product(product_id):
    conn = get_connection()
    try:
        row = conn.execute("SELECT * FROM products WHERE id=? AND is_active=1", (product_id,)).fetchone()
        if not row:
            return error("Ürün bulunamadı.", 404)
        return success(row_to_dict(row))
    finally:
        conn.close()


@app.route("/api/products/<int:product_id>", methods=["PUT"])
def update_product(product_id):
    """Ürün bilgilerini günceller (stok hariç — stok için /stock endpoint'i kullan)."""
    data = request.get_json(silent=True) or {}

    conn = get_connection()
    try:
        existing = conn.execute("SELECT * FROM products WHERE id=? AND is_active=1", (product_id,)).fetchone()
        if not existing:
            return error("Ürün bulunamadı.", 404)

        name        = (data.get("name") or existing["name"]).strip()
        barcode     = data.get("barcode", existing["barcode"])
        category    = (data.get("category") or existing["category"]).strip()
        expiry_date = data.get("expiry_date", existing["expiry_date"])
        image_url   = data.get("image_url", existing["image_url"])
        status      = calculate_status(expiry_date)

        with conn:
            conn.execute(
                """UPDATE products
                   SET name=?, barcode=?, category=?, expiry_date=?,
                       image_url=?, status=?, updated_at=datetime('now','localtime')
                   WHERE id=?""",
                (name, barcode, category, expiry_date, image_url, status, product_id)
            )
            log_action(conn, product_id, "UPDATE", note="Ürün bilgileri güncellendi")

        product = row_to_dict(conn.execute("SELECT * FROM products WHERE id=?", (product_id,)).fetchone())
        return success(product, "Ürün güncellendi.")
    finally:
        conn.close()


@app.route("/api/products/<int:product_id>", methods=["DELETE"])
def delete_product(product_id):
    """Soft Delete: is_active=0 yapar, veriyi silmez."""
    conn = get_connection()
    try:
        row = conn.execute("SELECT id FROM products WHERE id=? AND is_active=1", (product_id,)).fetchone()
        if not row:
            return error("Ürün bulunamadı.", 404)

        with conn:
            conn.execute(
                "UPDATE products SET is_active=0, updated_at=datetime('now','localtime') WHERE id=?",
                (product_id,)
            )
            log_action(conn, product_id, "DELETE", note="Ürün silindi (soft delete)")

        return success(message="Ürün silindi.")
    finally:
        conn.close()


# ─────────────────────────────────────────────
# /api/products/<id>/stock  — Stok güncelleme
# ─────────────────────────────────────────────

@app.route("/api/products/<int:product_id>/stock", methods=["POST"])
def update_stock(product_id):
    """
    Stok artır veya azalt.
    Body: { "action": "add"|"remove", "quantity": 5, "note": "..." }
    """
    data = request.get_json(silent=True) or {}
    action   = data.get("action", "add")     # "add" veya "remove"
    quantity = int(data.get("quantity", 0))
    note     = data.get("note", "")

    if quantity <= 0:
        return error("Miktar sıfırdan büyük olmalıdır.")

    conn = get_connection()
    try:
        row = conn.execute("SELECT * FROM products WHERE id=? AND is_active=1", (product_id,)).fetchone()
        if not row:
            return error("Ürün bulunamadı.", 404)

        current_stock = row["stock"]

        if action == "remove":
            if quantity > current_stock:
                return error(f"Yetersiz stok. Mevcut: {current_stock}")
            new_stock = current_stock - quantity
            action_type = "REMOVE"
            log_qty = -quantity
        else:
            new_stock  = current_stock + quantity
            action_type = "ADD"
            log_qty = quantity

        with conn:
            conn.execute(
                "UPDATE products SET stock=?, updated_at=datetime('now','localtime') WHERE id=?",
                (new_stock, product_id)
            )
            log_action(conn, product_id, action_type, log_qty, note or f"Stok {'artırıldı' if action=='add' else 'azaltıldı'}")

        # Kritik stok → Telegram bildirimi gönder
        if new_stock <= 5:
            _send_telegram(
                f"⚠️ Düşük Stok Uyarısı!\nÜrün: {row['name']}\nKalan Stok: {new_stock}"
            )

        product = row_to_dict(conn.execute("SELECT * FROM products WHERE id=?", (product_id,)).fetchone())
        return success(product, f"Stok {'artırıldı' if action=='add' else 'azaltıldı'}. Yeni stok: {new_stock}")
    finally:
        conn.close()


# ─────────────────────────────────────────────
# /api/logs  — Stok geçmişi
# ─────────────────────────────────────────────

@app.route("/api/logs")
def get_logs():
    limit = min(int(request.args.get("limit", 100)), 500)
    product_id_filter = request.args.get("product_id")

    conn = get_connection()
    try:
        query = """
            SELECT l.*, p.name as product_name
            FROM stock_logs l
            LEFT JOIN products p ON p.id = l.product_id
        """
        params = []
        if product_id_filter:
            query += " WHERE l.product_id=?"
            params.append(product_id_filter)

        query += " ORDER BY l.created_at DESC LIMIT ?"
        params.append(limit)

        rows = conn.execute(query, params).fetchall()
        return success([dict(r) for r in rows])
    finally:
        conn.close()


# ─────────────────────────────────────────────
# /api/barcode/<barcode>  — Open Food Facts
# ─────────────────────────────────────────────

@app.route("/api/barcode/<barcode>")
def lookup_barcode(barcode):
    """Open Food Facts API'yi kullanarak barkod bilgisi getirir."""
    try:
        url  = f"https://world.openfoodfacts.org/api/v0/product/{barcode}.json"
        resp = http_requests.get(url, timeout=5)
        resp.raise_for_status()
        payload = resp.json()

        if payload.get("status") != 1:
            return error("Barkod bulunamadı.", 404)

        product = payload.get("product", {})
        return success({
            "name": product.get("product_name_tr")
                    or product.get("product_name")
                    or product.get("product_name_en", ""),
            "image_url": product.get("image_front_url", ""),
            "category":  product.get("categories", "").split(",")[0].strip() if product.get("categories") else "Diğer",
            "barcode":   barcode
        })
    except http_requests.exceptions.RequestException:
        return error("Open Food Facts servisine ulaşılamadı.", 503)


# ─────────────────────────────────────────────
# /api/import  — CSV toplu yükleme
# ─────────────────────────────────────────────

@app.route("/api/import", methods=["POST"])
def import_csv():
    """
    CSV dosyası ile toplu ürün yükleme.
    Beklenen kolon başlıkları: name, stock, expiry_date, category, barcode, image_url
    """
    if "file" not in request.files:
        return error("Dosya bulunamadı. 'file' alanı gerekli.")

    file = request.files["file"]
    if not file.filename.endswith((".csv", ".txt")):
        return error("Sadece CSV dosyaları desteklenmektedir.")

    content = file.read().decode("utf-8-sig")  # BOM'lu UTF-8 de okunur
    reader  = csv.DictReader(io.StringIO(content))

    conn    = get_connection()
    added   = 0
    errors  = []

    try:
        with conn:
            for i, row in enumerate(reader, start=2):  # 2. satırdan başlar (1. başlık)
                name = (row.get("name") or "").strip()
                if not name:
                    errors.append(f"Satır {i}: Ürün adı eksik, atlandı.")
                    continue

                try:
                    stock = int(row.get("stock", 0))
                except ValueError:
                    stock = 0

                expiry_date = (row.get("expiry_date") or "").strip() or None
                category    = (row.get("category") or "Diğer").strip()
                barcode     = (row.get("barcode") or "").strip() or None
                image_url   = (row.get("image_url") or "").strip() or None
                status      = calculate_status(expiry_date)

                cur = conn.execute(
                    """INSERT INTO products (barcode, name, stock, expiry_date, category, status, image_url)
                       VALUES (?, ?, ?, ?, ?, ?, ?)""",
                    (barcode, name, stock, expiry_date, category, status, image_url)
                )
                log_action(conn, cur.lastrowid, "CREATE", stock, "CSV import")
                added += 1

        return success({"added": added, "errors": errors}, f"{added} ürün başarıyla içe aktarıldı.")
    finally:
        conn.close()


# ─────────────────────────────────────────────
# Telegram bildirimi (stub)
# ─────────────────────────────────────────────

def _send_telegram(message: str) -> None:
    """Telegram Bot API'si aracılığıyla bildirim gönderir.
    TELEGRAM_BOT_TOKEN ve TELEGRAM_CHAT_ID ortam değişkenleri ayarlanmalıdır.
    """
    if not TELEGRAM_TOKEN or not TELEGRAM_CHAT_ID:
        return  # Yapılandırılmamışsa sessizce atla

    try:
        url = f"https://api.telegram.org/bot{TELEGRAM_TOKEN}/sendMessage"
        http_requests.post(url, json={
            "chat_id": TELEGRAM_CHAT_ID,
            "text": message,
            "parse_mode": "HTML"
        }, timeout=5)
    except Exception:
        pass  # Bildirim başarısız olsa bile ana akışı engelleme


# ─────────────────────────────────────────────
# Uygulama başlatma
# ─────────────────────────────────────────────

if __name__ == "__main__":
    import sys, io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

    init_db()   # Tablolar yoksa olustur
    print("[OK] Veritabani hazir.")
    print("[>>] Sunucu baslatiliyor -> http://localhost:5000")
    app.run(debug=True, host="0.0.0.0", port=5000)
