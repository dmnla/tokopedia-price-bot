# sku_map_v2.py
"""
SKU Map & Competitor Price Checker – v3.2 (2025‑06‑28)
=====================================================
Full end‑to‑end script for GitHub Actions.
• Pull live data from **Master** tab.
• Detect store URL columns (`Daily_Bike` + competitors).
• Scrape Tokopedia prices (meta / JSON).
• Write enriched sheet to **Result** tab.
NOTE: v3.2 fixes a missing `import os` (was referenced before import).
"""
from __future__ import annotations

import os
import re
import time
from datetime import datetime
from typing import List, Tuple

import pandas as pd
import requests
from bs4 import BeautifulSoup
import gspread
from google.oauth2.service_account import Credentials

# === CONFIG ===============================================================
SHEET_ID = "1AUR672p_1hsxjc3jmkqY4vkRAjBSrpPaTYUFNNFAkrY"  # <-- do not edit
INPUT_TAB = "Master"
OUTPUT_TAB = "Result"
SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]
REQUEST_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/125.0 Safari/537.36"
    )
}
SLEEP_BETWEEN_REQUESTS = 1  # seconds
MAX_RETRIES = 3

META_COLS = ["category", "brand", "sku_code"]
STATUS_COL = "status"
OUR_STORE_NAME = "Daily_Bike"  # must match column header exactly

# === HELPERS ==============================================================

def auth_gspread() -> gspread.Client:
    """Authorise using service‑account creds pointed to by env var."""
    creds = Credentials.from_service_account_file(
        filename=os.environ["GOOGLE_APPLICATION_CREDENTIALS"],
        scopes=SCOPES,
    )
    return gspread.authorize(creds)


def read_master_sheet(gc: gspread.Client) -> pd.DataFrame:
    sh = gc.open_by_key(SHEET_ID)
    ws = sh.worksheet(INPUT_TAB)
    df = pd.DataFrame(ws.get_all_records())
    # normalise column names (strip spaces)
    df.columns = [c.strip() for c in df.columns]
    return df


def detect_store_columns(df: pd.DataFrame) -> Tuple[str, List[str]]:
    """Return (our_store, competitors) based on column headers."""
    candidates = [c for c in df.columns if c not in META_COLS + [STATUS_COL]]
    if OUR_STORE_NAME not in candidates:
        raise ValueError(
            f"Expected our store column '{OUR_STORE_NAME}' not found. Columns: {candidates}"
        )
    competitors = [c for c in candidates if c != OUR_STORE_NAME]
    return OUR_STORE_NAME, competitors

TOKO_META_PRICE = re.compile(r"product:price:amount", re.I)
JSON_PRICE = re.compile(r'"price"\s*:\s*([0-9]+(?:\.[0-9]+)?)')


def scrape_tokopedia_price(url: str) -> float | None:
    for _ in range(MAX_RETRIES):
        try:
            resp = requests.get(url, headers=REQUEST_HEADERS, timeout=20)
            if resp.status_code != 200:
                time.sleep(SLEEP_BETWEEN_REQUESTS)
                continue
            soup = BeautifulSoup(resp.text, "lxml")
            # 1) meta tag
            meta = soup.find("meta", {"property": TOKO_META_PRICE})
            if meta and meta.get("content"):
                return float(meta["content"].replace(",", ""))
            # 2) regex JSON fallback
            match = JSON_PRICE.search(resp.text)
            if match:
                return float(match.group(1))
        except Exception:
            pass
        time.sleep(SLEEP_BETWEEN_REQUESTS)
    return None


def enrich_prices(df: pd.DataFrame, stores: List[str]) -> pd.DataFrame:
    for store in stores:
        df[f"{store}_price"] = None

    for idx, row in df.iterrows():
        for store in stores:
            url = row.get(store)
            if not url:
                continue
            price = scrape_tokopedia_price(url)
            df.at[idx, f"{store}_price"] = price

    return df


def compute_diff(df: pd.DataFrame, our_price_col: str, competitors: List[str]):
    comp_price_cols = [f"{c}_price" for c in competitors]
    df["PriceDiffVsLowest"] = df[our_price_col] - df[comp_price_cols].min(axis=1)


def write_result_sheet(gc: gspread.Client, df: pd.DataFrame):
    sh = gc.open_by_key(SHEET_ID)
    try:
        ws = sh.worksheet(OUTPUT_TAB)
        ws.clear()
    except gspread.WorksheetNotFound:
        ws = sh.add_worksheet(title=OUTPUT_TAB, rows="100", cols="20")

    ws.update([df.columns.values.tolist()] + df.values.tolist())

# === MAIN ================================================================

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--max", type=int, default=None, help="Limit rows for debug")
    args = parser.parse_args()

    gc = auth_gspread()
    df = read_master_sheet(gc)

    # filter tracked SKUs
    df = df[df[STATUS_COL].str.lower() == "track"].reset_index(drop=True)
    if args.max:
        df = df.head(args.max)

    our_store, competitor_stores = detect_store_columns(df)
    all_stores = [our_store] + competitor_stores

    df = enrich_prices(df, all_stores)
    compute_diff(df, f"{our_store}_price", competitor_stores)

    df["CheckedAt"] = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%SZ")

    write_result_sheet(gc, df)
    print(f"✅ Updated {OUTPUT_TAB} with {len(df)} rows.")
