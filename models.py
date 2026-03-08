"""
models.py — Smart Inventory & Expiration Manager
Veritabanı modelleri ve yardımcı fonksiyonlar.
SQLite kullanılarak kalıcı veri depolama.
"""

import sqlite3
from datetime import datetime, date
from pathlib import Path

# Veritabanı dosyası proje kök dizininde oluşturulur
DB_PATH = Path(__file__).parent / "inventory.db"


# ──────────────────────────────────────────────
# Bağlantı yardımcısı
# ──────────────────────────────────────────────

def get_connection() -> sqlite3.Connection:
    """Her istek için ayrı bir SQLite bağlantısı döndürür.
    row_factory ile satırlar sözlük gibi erişilebilir hale gelir.
    """
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row          # row["column"] erişimine izin verir
    conn.execute("PRAGMA journal_mode=WAL")  # Eş zamanlı okumayı iyileştirir
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


# ──────────────────────────────────────────────
# SKT Durum Hesaplama
# ──────────────────────────────────────────────

def calculate_status(expiry_date_str: str | None) -> str:
    """
    SKT'ye göre ürün durumunu döndürür.

    Durum seçenekleri:
        "Normal"       — SKT 4+ gün sonra
        "Kritik"       — SKT 0-3 gün içinde (bugün dahil)
        "Tarihi Geçti" — SKT geçmiş
        "Belirsiz"     — Tarih belirtilmemiş
    """
    if not expiry_date_str:
        return "Belirsiz"

    try:
        expiry = datetime.strptime(expiry_date_str, "%Y-%m-%d").date()
    except ValueError:
        return "Belirsiz"

    today = date.today()
    delta = (expiry - today).days

    if delta < 0:
        return "Tarihi Geçti"
    elif delta <= 3:
        return "Kritik"
    else:
        return "Normal"


def days_until_expiry(expiry_date_str: str | None) -> int | None:
    """SKT'ye kaç gün kaldığını döndürür. Tarih yoksa None."""
    if not expiry_date_str:
        return None
    try:
        expiry = datetime.strptime(expiry_date_str, "%Y-%m-%d").date()
        return (expiry - date.today()).days
    except ValueError:
        return None


# ──────────────────────────────────────────────
# Tablo Oluşturma (Migration)
# ──────────────────────────────────────────────

def init_db() -> None:
    """Uygulama ilk başlatıldığında tabloları oluşturur.
    Tablolar zaten varsa hiçbir şey yapmaz (IF NOT EXISTS).
    """
    conn = get_connection()
    with conn:
        conn.executescript("""
            -- Ürünler tablosu
            CREATE TABLE IF NOT EXISTS products (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                barcode     TEXT,           -- Barkod numarası (opsiyonel)
                name        TEXT NOT NULL,  -- Ürün adı
                stock       INTEGER NOT NULL DEFAULT 0,
                expiry_date TEXT,           -- YYYY-MM-DD formatı
                category    TEXT NOT NULL DEFAULT 'Diğer',
                status      TEXT NOT NULL DEFAULT 'Normal',
                image_url   TEXT,           -- Harici resim URL'i
                is_active   INTEGER NOT NULL DEFAULT 1,  -- Soft Delete bayrağı
                created_at  TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
                updated_at  TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
            );

            -- Stok geçmişi / log tablosu
            CREATE TABLE IF NOT EXISTS stock_logs (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                product_id  INTEGER NOT NULL,
                action_type TEXT NOT NULL,  -- 'ADD', 'REMOVE', 'CREATE', 'UPDATE', 'DELETE'
                quantity    INTEGER,        -- Değişim miktarı (negatif olabilir)
                note        TEXT,
                created_at  TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
                FOREIGN KEY (product_id) REFERENCES products (id)
            );

            -- Daha hızlı sorgular için indeksler
            CREATE INDEX IF NOT EXISTS idx_products_barcode   ON products (barcode);
            CREATE INDEX IF NOT EXISTS idx_products_is_active ON products (is_active);
            CREATE INDEX IF NOT EXISTS idx_logs_product_id    ON stock_logs (product_id);
        """)
    conn.close()


# ──────────────────────────────────────────────
# Ürün yardımcı fonksiyonları
# ──────────────────────────────────────────────

def row_to_dict(row: sqlite3.Row) -> dict:
    """sqlite3.Row nesnesini JSON serileştirilebilir dict'e çevirir
    ve hesaplanmış alanları ekler.
    """
    d = dict(row)
    d["status"] = calculate_status(d.get("expiry_date"))
    d["days_until_expiry"] = days_until_expiry(d.get("expiry_date"))
    return d


def log_action(conn: sqlite3.Connection, product_id: int,
               action_type: str, quantity: int | None = None,
               note: str = "") -> None:
    """Bir stok/işlem kaydını stock_logs tablosuna yazar."""
    conn.execute(
        """INSERT INTO stock_logs (product_id, action_type, quantity, note)
           VALUES (?, ?, ?, ?)""",
        (product_id, action_type, quantity, note)
    )
