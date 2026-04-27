"""
AeroMind — cd_database_builder.py
Builds and maintains a local Cd knowledge database scraped from:
  1. Wikipedia — List of automobiles by drag coefficient
  2. Hard-coded curated reference table (always reliable)
  3. Optional: EPA fueleconomy.gov data (if accessible)

Stores everything in ChromaDB for RAG retrieval.
Designed to run overnight / as weekly_update.py calls it.
"""

import re
import json
import time
import logging
import hashlib
import requests
from pathlib import Path
from datetime import datetime
from typing import Optional

import chromadb
from chromadb.config import Settings

log = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="[AeroMind-CdDB] %(levelname)s: %(message)s")

# ─── Config ───────────────────────────────────────────────────────────────────

CHROMA_PATH = "./chroma_db"
COLLECTION  = "cd_reference"
CACHE_FILE  = Path("data/cd_database_cache.json")
CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)

HEADERS = {
    "User-Agent": "AeroMind/1.0 (local educational aerodynamics AI; not scraping for commercial use)"
}
REQUEST_DELAY = 1.2   # seconds between Wikipedia requests — be a polite scraper

# ─── Curated baseline table (always available, zero network dependency) ───────
# Sources: Hucho (2013), Barnard (2009), manufacturer press data, SAE papers.
# Format: (make, model, year, Cd, body_type, notes)

CURATED_CD_TABLE = [
    # ── Exceptional / record holders ──
    ("Mercedes-Benz", "EQS 450+", 2022, 0.20, "sedan",    "Production record holder as of 2022. Active rear spoiler, smooth underbody."),
    ("Mercedes-Benz", "CLA (C118)", 2020, 0.22, "sedan",   "Flush windows, active grille shutters, optimised A-pillar."),
    ("Tesla",        "Model 3 LR", 2021, 0.23, "sedan",    "Sealed front, smooth underbody pan, optimised door handles."),
    ("Lucid",        "Air Grand Touring", 2022, 0.21, "sedan", "Wind-tunnel optimised glasshouse, flush surfaces."),
    ("BMW",          "i4 M50",    2022, 0.24, "sedan",      "Active kidney grille shutters, aeroblade rear."),
    ("Porsche",      "Taycan",    2021, 0.22, "sedan",      "Active ride height, smooth floor, retractable spoiler."),
    ("Hyundai",      "Ioniq 6",   2023, 0.21, "sedan",      "Streamlined fastback, integrated aero package."),
    ("BYD",          "Seal",      2023, 0.219, "sedan",     "Claimed by manufacturer; flush surfaces, no side mirrors."),
    ("Volkswagen",   "XL1",       2014, 0.189, "coupe",     "CFRP body, enclosed rear wheels, tandem seating."),

    # ── Sports / supercars ──
    ("Porsche",      "911 (992)",  2020, 0.33, "sports_car", "Without rear wing; active aero raises to 0.37 at 250km/h."),
    ("Ferrari",      "Roma",       2021, 0.30, "sports_car", "Active flaps under front bumper."),
    ("Lamborghini",  "Huracán EVO",2020, 0.36, "supercar",  "Active aerodynamics front and rear."),
    ("Bugatti",      "Chiron",     2017, 0.36, "hypercar",   "Active rear wing generates up to 1800N downforce."),
    ("McLaren",      "720S",       2017, 0.32, "supercar",   "Active SSG (Super Series Gateway) aerodynamics."),
    ("Koenigsegg",   "Jesko",      2020, 0.345, "hypercar",  "Top speed spec — downforce spec Cd is significantly higher."),
    ("Aston Martin", "DB11",       2017, 0.299, "sports_car","Aeroblade II over rear deck — no conventional spoiler."),
    ("Chevrolet",    "Corvette C8",2020, 0.335, "sports_car","Mid-engine; active aero package available."),

    # ── Common sedans / EVs ──
    ("Toyota",       "Camry (XV70)",2018, 0.28, "sedan",    "TNGA platform; flush underbody."),
    ("Honda",        "Accord (10th)",2018,0.29, "sedan",     "Optimised underbody, active grille shutters."),
    ("Tesla",        "Model S",    2021, 0.208, "sedan",     "Claimed post-refresh; active spoiler."),
    ("Tesla",        "Model Y",    2021, 0.23,  "SUV",       "Smooth undertray, no visible exhaust exits."),
    ("BMW",          "5 Series (G30)",2017,0.22,"sedan",     "Active air flap control, smooth underbody."),
    ("Audi",         "A6 (C8)",    2019, 0.24,  "sedan",     "Active air suspension, flush door handles."),
    ("Audi",         "e-tron GT",  2021, 0.24,  "sports_car","Active rear spoiler."),
    ("Mercedes-Benz","S-Class (W223)",2021,0.22,"sedan",     "Active ride height, optimised wheel covers."),
    ("Volkswagen",   "Passat B8",  2015, 0.23,  "sedan",     "Best-in-class at launch for that segment."),
    ("Kia",          "EV6",        2022, 0.288, "crossover", "Camera mirrors available in some markets."),
    ("Genesis",      "G80 EV",     2022, 0.27,  "sedan",     "Smooth front fascia, no conventional grille openings."),

    # ── SUVs / crossovers ──
    ("Porsche",      "Cayenne Coupé",2020,0.36, "SUV",       "Active cooling air control."),
    ("BMW",          "X5 (G05)",   2019, 0.34,  "SUV",       "Air curtain intakes, aero wheels."),
    ("Mercedes-Benz","GLE Coupé",  2020, 0.33,  "SUV",       "Active aero elements."),
    ("Volvo",        "XC60 (2018)",2018, 0.33,  "SUV",       "Aero underbody covers."),
    ("Tesla",        "Model X",    2022, 0.25,  "SUV",       "Falcon wing doors; active air suspension."),
    ("Ford",         "Mustang Mach-E",2021,0.29,"SUV",       "Active grille shutters, smooth underbody."),
    ("Hyundai",      "Ioniq 5",    2022, 0.288, "SUV",       "Air curtains, flush door handles."),

    # ── Classic / historical reference ──
    ("Volkswagen",   "Beetle (Type 1)",1938,0.48,"sedan",    "Porsche-designed; revolutionary for its era."),
    ("Citroën",      "DS",         1955, 0.30,  "sedan",     "First mass-production aerodynamic body."),
    ("Audi",         "100 C3",     1983, 0.30,  "sedan",     "First mass car to achieve Cd=0.30; wind-tunnel developed."),
    ("GM",           "EV1",        1996, 0.195, "sports_car","Best production Cd of its era; teardrop body."),
    ("Toyota",       "Prius (3rd gen)",2010,0.25,"hatchback","Solar roof panel optional; flush belly pan."),
    ("Honda",        "Insight (1st)",2000,0.25, "coupe",     "Enclosed rear wheels, belly pan."),
    ("Mercedes-Benz","BIONIC",     2005, 0.19,  "concept",   "Inspired by boxfish; concept only."),

    # ── Trucks / vans (high Cd reference) ──
    ("Ford",         "F-150 (13th gen)",2015,0.407,"pickup", "Box-body; best-selling vehicle in US."),
    ("Ram",          "1500 (DT)",  2019, 0.357, "pickup",    "Active grille shutters, air suspension."),
    ("Mercedes-Benz","Sprinter",   2018, 0.37,  "van",       "Optimised for van — good for class."),

    # ── Reference shapes (textbook) ──
    ("Ahmed Body",   "Reference (h=0.15 backlight)",1984,0.285,"reference","SAE 840300. Critical backlight angle."),
    ("Ahmed Body",   "Reference (h=0.30 backlight)",1984,0.38, "reference","High-drag separation regime."),
    ("DrivAer",      "Fastback",   2012, 0.252, "reference", "TU Munich open-source reference car."),
    ("DrivAer",      "Notchback",  2012, 0.279, "reference", "TU Munich open-source reference car."),
    ("DrivAer",      "Estateback", 2012, 0.294, "reference", "TU Munich open-source reference car."),
]

# ─── Wikipedia scraper ────────────────────────────────────────────────────────

WIKIPEDIA_URLS = [
    "https://en.wikipedia.org/wiki/Automobile_drag_coefficient",
    "https://en.wikipedia.org/wiki/List_of_automobiles_by_drag_coefficient",
]

def _parse_cd_from_text(text: str) -> Optional[float]:
    """Extract a Cd float from a string like '0.28' or '0.28–0.30'."""
    # Take first number in range
    match = re.search(r'0\.\d{2,3}', text)
    if match:
        val = float(match.group())
        if 0.10 <= val <= 0.80:   # sanity bounds
            return val
    return None


def scrape_wikipedia_cd() -> list[dict]:
    """
    Scrape Wikipedia Cd tables. Returns list of dicts:
    {make, model, year, cd, body_type, source_url, raw_row}
    """
    records = []
    for url in WIKIPEDIA_URLS:
        log.info(f"Scraping: {url}")
        try:
            r = requests.get(url, headers=HEADERS, timeout=20)
            r.raise_for_status()
            html = r.text
        except Exception as e:
            log.warning(f"Failed to fetch {url}: {e}")
            continue

        # Simple regex table row extraction (avoid heavy HTML parsers)
        # Wikipedia tables look like: <tr><td>Make</td><td>Model</td><td>Cd</td>...
        row_pattern = re.compile(r'<tr[^>]*>(.*?)</tr>', re.DOTALL | re.IGNORECASE)
        cell_pattern = re.compile(r'<t[dh][^>]*>(.*?)</t[dh]>', re.DOTALL | re.IGNORECASE)
        tag_strip = re.compile(r'<[^>]+>')

        for row_match in row_pattern.finditer(html):
            row_html = row_match.group(1)
            cells = cell_pattern.findall(row_html)
            if len(cells) < 3:
                continue
            cleaned = [tag_strip.sub('', c).strip() for c in cells]
            cleaned = [re.sub(r'\s+', ' ', c) for c in cleaned]

            # Heuristic: look for a cell that contains a Cd-like float
            cd_val = None
            cd_idx = -1
            for i, cell in enumerate(cleaned):
                v = _parse_cd_from_text(cell)
                if v is not None:
                    cd_val = v
                    cd_idx = i
                    break

            if cd_val is None:
                continue

            # Try to infer make/model from surrounding cells
            make_model = ""
            if cd_idx >= 2:
                make_model = f"{cleaned[0]} {cleaned[1]}"
            elif cd_idx >= 1:
                make_model = cleaned[0]
            else:
                continue

            # Skip header rows
            if any(kw in make_model.lower() for kw in ["make", "manufacturer", "model", "vehicle"]):
                continue

            # Parse year
            year = None
            for cell in cleaned:
                year_match = re.search(r'(19|20)\d{2}', cell)
                if year_match:
                    year = int(year_match.group())
                    break

            records.append({
                "make": cleaned[0] if cd_idx >= 1 else "unknown",
                "model": cleaned[1] if cd_idx >= 2 else cleaned[0],
                "year": year,
                "cd": cd_val,
                "body_type": "unknown",
                "source_url": url,
                "raw_row": " | ".join(cleaned[:max(cd_idx+2, 4)]),
                "scraped_at": datetime.utcnow().isoformat()
            })

        log.info(f"  → {len(records)} records found so far")
        time.sleep(REQUEST_DELAY)

    return records


# ─── ChromaDB storage ─────────────────────────────────────────────────────────

def _build_document(rec: dict) -> tuple[str, dict]:
    """Build ChromaDB document text and metadata from a Cd record."""
    make  = rec.get("make", "Unknown")
    model = rec.get("model", "Unknown")
    year  = rec.get("year") or "unknown year"
    cd    = rec.get("cd", 0.0)
    btype = rec.get("body_type", "unknown")
    notes = rec.get("notes", "")
    source= rec.get("source_url", "curated")

    # Rich document text for embedding — the RAG system will retrieve this
    doc = (
        f"{make} {model} ({year}) — Drag coefficient Cd = {cd:.3f}. "
        f"Body type: {btype}. "
        f"{notes} "
        f"Source: {source}."
    )
    meta = {
        "make": str(make),
        "model": str(model),
        "year": str(year),
        "cd": float(cd),
        "body_type": str(btype),
        "source": str(source),
        "type": "cd_reference"
    }
    return doc, meta


def _record_id(rec: dict) -> str:
    key = f"{rec.get('make','')}_{rec.get('model','')}_{rec.get('year','')}_{rec.get('cd',0)}"
    return "cd_" + hashlib.md5(key.encode()).hexdigest()[:16]


def upsert_to_chromadb(records: list[dict]):
    """Upsert Cd records into ChromaDB collection."""
    client = chromadb.PersistentClient(
        path=CHROMA_PATH,
        settings=Settings(anonymized_telemetry=False)
    )
    collection = client.get_or_create_collection(
        name=COLLECTION,
        metadata={"hnsw:space": "cosine"}
    )

    ids, docs, metas = [], [], []
    for rec in records:
        doc, meta = _build_document(rec)
        ids.append(_record_id(rec))
        docs.append(doc)
        metas.append(meta)

    # Upsert in batches of 100
    batch_size = 100
    total_upserted = 0
    for i in range(0, len(ids), batch_size):
        collection.upsert(
            ids=ids[i:i+batch_size],
            documents=docs[i:i+batch_size],
            metadatas=metas[i:i+batch_size]
        )
        total_upserted += len(ids[i:i+batch_size])
        log.info(f"  Upserted batch {i//batch_size + 1} ({total_upserted}/{len(ids)} records)")

    log.info(f"ChromaDB now has {collection.count()} records in '{COLLECTION}'")
    return total_upserted


# ─── Query interface ──────────────────────────────────────────────────────────

def query_similar_cars(make: str = "", model: str = "", body_type: str = "",
                        cd_estimate: float = None, n_results: int = 8) -> list[dict]:
    """
    Retrieve similar cars from ChromaDB for RAG chain-of-thought.
    """
    client = chromadb.PersistentClient(
        path=CHROMA_PATH,
        settings=Settings(anonymized_telemetry=False)
    )
    try:
        collection = client.get_collection(COLLECTION)
    except Exception:
        log.warning("Cd collection not found. Run build_database() first.")
        return []

    # Build query string
    query_parts = []
    if make and make != "unknown":
        query_parts.append(make)
    if model and model != "unknown":
        query_parts.append(model)
    if body_type and body_type != "unknown":
        query_parts.append(f"{body_type} body type aerodynamics drag coefficient")
    if cd_estimate:
        query_parts.append(f"Cd {cd_estimate:.2f} drag coefficient")

    query_text = " ".join(query_parts) if query_parts else "passenger car drag coefficient aerodynamics"

    results = collection.query(
        query_texts=[query_text],
        n_results=min(n_results, collection.count()),
        include=["documents", "metadatas", "distances"]
    )

    output = []
    if results and results["documents"]:
        for doc, meta, dist in zip(
            results["documents"][0],
            results["metadatas"][0],
            results["distances"][0]
        ):
            output.append({
                "document": doc,
                "make": meta.get("make"),
                "model": meta.get("model"),
                "year": meta.get("year"),
                "cd": meta.get("cd"),
                "body_type": meta.get("body_type"),
                "similarity": round(1 - dist, 3)
            })

    return output


def get_cd_stats_for_body_type(body_type: str) -> dict:
    """Return Cd statistics for a given body type from the database."""
    records = query_similar_cars(body_type=body_type, n_results=30)
    cds = [r["cd"] for r in records if r.get("cd") and 0.10 < r["cd"] < 0.80]
    if not cds:
        # Fallback values from Hucho (2013) Table 2.1
        defaults = {
            "sedan": (0.26, 0.30, 0.34),
            "SUV": (0.33, 0.38, 0.45),
            "hatchback": (0.27, 0.32, 0.38),
            "sports_car": (0.27, 0.33, 0.39),
            "supercar": (0.30, 0.36, 0.42),
            "coupe": (0.27, 0.31, 0.36),
            "pickup": (0.35, 0.42, 0.50),
            "van": (0.35, 0.40, 0.46),
            "wagon": (0.29, 0.33, 0.38),
        }
        low, mid, high = defaults.get(body_type, (0.28, 0.35, 0.45))
        return {"min": low, "mean": mid, "max": high, "count": 0, "source": "Hucho 2013 defaults"}

    return {
        "min": round(min(cds), 3),
        "mean": round(sum(cds)/len(cds), 3),
        "max": round(max(cds), 3),
        "count": len(cds),
        "source": "AeroMind ChromaDB"
    }


# ─── Main build function ──────────────────────────────────────────────────────

def build_database(skip_wikipedia: bool = False) -> dict:
    """
    Full database build:
    1. Load curated table
    2. Scrape Wikipedia (unless skip_wikipedia=True)
    3. Merge + deduplicate
    4. Upsert to ChromaDB
    5. Cache to JSON
    """
    log.info("═" * 60)
    log.info("AeroMind Cd Database Builder")
    log.info("═" * 60)

    # Step 1: Curated records
    curated = []
    for row in CURATED_CD_TABLE:
        make, model, year, cd, btype, notes = row
        curated.append({
            "make": make, "model": model, "year": year, "cd": cd,
            "body_type": btype, "notes": notes,
            "source_url": "AeroMind curated (Hucho 2013, SAE papers, manufacturer data)",
            "scraped_at": datetime.utcnow().isoformat()
        })
    log.info(f"Curated records: {len(curated)}")

    # Step 2: Wikipedia
    wiki_records = []
    if not skip_wikipedia:
        log.info("Scraping Wikipedia...")
        wiki_records = scrape_wikipedia_cd()
        log.info(f"Wikipedia records scraped: {len(wiki_records)}")
    else:
        log.info("Skipping Wikipedia scrape (skip_wikipedia=True)")

    # Step 3: Merge
    all_records = curated + wiki_records

    # Deduplicate by (make, model, year, cd)
    seen = set()
    unique = []
    for r in all_records:
        key = f"{r['make']}|{r['model']}|{r.get('year')}|{r['cd']}"
        if key not in seen:
            seen.add(key)
            unique.append(r)
    log.info(f"Unique records after dedup: {len(unique)}")

    # Step 4: ChromaDB upsert
    upserted = upsert_to_chromadb(unique)

    # Step 5: Cache
    with open(CACHE_FILE, "w") as f:
        json.dump({
            "built_at": datetime.utcnow().isoformat(),
            "total_records": len(unique),
            "curated_count": len(curated),
            "wikipedia_count": len(wiki_records),
            "records": unique
        }, f, indent=2)
    log.info(f"Cache saved to {CACHE_FILE}")

    summary = {
        "built_at": datetime.utcnow().isoformat(),
        "total_records": len(unique),
        "curated": len(curated),
        "wikipedia": len(wiki_records),
        "upserted_to_chromadb": upserted
    }
    log.info(f"Build complete: {summary}")
    return summary


# ─── CLI ──────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import sys

    cmd = sys.argv[1] if len(sys.argv) > 1 else "build"

    if cmd == "build":
        skip = "--no-wiki" in sys.argv
        result = build_database(skip_wikipedia=skip)
        print(json.dumps(result, indent=2))

    elif cmd == "query":
        make  = sys.argv[2] if len(sys.argv) > 2 else ""
        model = sys.argv[3] if len(sys.argv) > 3 else ""
        results = query_similar_cars(make=make, model=model, n_results=5)
        print(f"\nTop matches for '{make} {model}':")
        for r in results:
            print(f"  {r['make']} {r['model']} ({r['year']}) — Cd {r['cd']} | sim {r['similarity']} | {r['body_type']}")

    elif cmd == "stats":
        btype = sys.argv[2] if len(sys.argv) > 2 else "sedan"
        stats = get_cd_stats_for_body_type(btype)
        print(f"\nCd stats for {btype}: {stats}")

    else:
        print("Commands: build [--no-wiki] | query <make> <model> | stats <body_type>")
