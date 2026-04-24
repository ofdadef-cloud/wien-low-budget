import os
import sys
import re
import requests
import time
from bs4 import BeautifulSoup
from groq import Groq
from dotenv import load_dotenv

# Load .env from project root (one level up from scripts/)
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.join(SCRIPT_DIR, "..")
load_dotenv(os.path.join(PROJECT_DIR, ".env"))

API_KEY = os.getenv("GROQ_API_KEY")
DATA_JS_PATH = os.path.join(SCRIPT_DIR, "../data.js")

if not API_KEY or API_KEY == "your_api_key_here":
    print("Error: Bitte füge deinen GROQ_API_KEY in der .env Datei ein.")
    print("  Kostenloser Key: https://console.groq.com/keys")
    exit(1)

# Initialize Groq client (100% kostenlos, keine EU-Sperren)
client = Groq(api_key=API_KEY)

# ── Crawler ──────────────────────────────────────────────────
def crawl_web(query):
    print(f"  Suche im Web nach: {query}...")
    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
    }
    url = f"https://html.duckduckgo.com/html/?q={query.replace(' ', '+')}"
    try:
        response = requests.get(url, headers=headers, timeout=10)
        soup = BeautifulSoup(response.text, 'html.parser')
        results = soup.find_all('a', class_='result__snippet')
        snippets = [res.get_text(strip=True) for res in results[:8]]
        context = "\n".join(snippets)
        print(f"  -> {len(snippets)} Suchergebnisse gefunden.")
        return context
    except Exception as e:
        print(f"  Crawler-Fehler: {e}")
        return "(Keine Web-Daten verfügbar)"

# ── Data Reader ─────────────────────────────────────────────
def read_category_entries(file_path, category):
    """Liest nur die Einträge der gewählten Kategorie aus data.js."""
    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()

    # Extract full LOCATIONS block
    start = content.find("const LOCATIONS = [")
    end = content.find("const VIDEO_GUIDES = [")
    if start == -1 or end == -1:
        raise ValueError("Konnte das LOCATIONS-Array in data.js nicht finden.")
    
    locations_block = content[start:end]

    # Split into individual objects by finding { id: ... } blocks
    # Extract all entries for the given category
    pattern = rf"\{{[^{{}}]*?category:\s*['\"]({category})['\"][^{{}}]*?\}}"
    matches = re.findall(r'\{[^{}]*?\}', locations_block, re.DOTALL)
    
    category_entries = []
    for m in matches:
        if f"category: '{category}'" in m or f'category: "{category}"' in m:
            category_entries.append(m)

    return "\n  ".join(category_entries), content, start, end

def apply_update(file_path, category, new_entries_js, original_content, locations_start, locations_end):
    """Ersetzt nur die Kategorie-Einträge in data.js."""
    locations_block = original_content[locations_start:locations_end]
    
    # Find the category section comment header, e.g. // ─── ESSEN ───
    # We'll replace between the category comment and the next comment block
    comment_map = {
        'essen': 'ESSEN',
        'bars': 'BARS',
        'museen': 'MUSEEN',
        'unterkunft': 'UNTERK',
        'natur': 'NATUR',
        'einkaufen': 'EINKAUF',
        'baeckerei': 'BÄCK',
        'kino': 'KINO',
        'cafe': 'CAF',
        'transport': 'TRANSPORT',
        'deals': 'DEALS'
    }
    
    # Build a regex to find the category block
    keyword = comment_map.get(category, category.upper())
    
    # Find start of category section
    cat_start = locations_block.find(f"// ─── {keyword[:4].upper()}")
    if cat_start == -1:
        print(f"  Warnung: Konnte den Abschnitt für '{category}' nicht finden. Datei bleibt unverändert.")
        return
    
    # Find the NEXT comment section after this one
    next_section = locations_block.find("// ───", cat_start + 10)
    if next_section == -1:
        next_section = len(locations_block)
    
    # Ensure the block ends with a comma to not break the JS array
    if not new_entries_js.rstrip().endswith(','):
        new_entries_js = new_entries_js.rstrip() + ','
        
    new_block = f"\n  {comment_line}  {new_entries_js}\n\n"
    
    new_locations = locations_block[:cat_start] + new_block + locations_block[next_section:]
    new_content = original_content[:locations_start] + new_locations + original_content[locations_end:]
    
    with open(file_path, 'w', encoding='utf-8') as f:
        f.write(new_content)
    print(f"  -> data.js erfolgreich mit neuen '{category}'-Einträgen aktualisiert!")

# ── LLM Planner ─────────────────────────────────────────────
def plan_update(category_entries, category, web_context):
    print(f"  KI plant Verbesserungen für Kategorie '{category}'...")

    prompt = f"""Du bist ein Experte für kostengünstiges Reisen in Wien.

Aktuelle Datenbank-Einträge für die Kategorie '{category}':
```
{category_entries}
```

Neue Web-Recherche für '{category}' in Wien (2026):
{web_context}

AUFGABE:
1. Identifiziere veraltete oder geschlossene Orte in den obigen Einträgen.
2. Ergänze neue, günstige Optionen aus der Web-Recherche (falls sinnvoll).
3. Gib die AKTUALISIERTE Liste aller '{category}'-Einträge als einzelne JavaScript-Objekte zurück.
4. Jedes Objekt MUSS diese Felder haben: id (Zahl), name, category (= '{category}'), address, district, lat, lng, description (auf Deutsch), priceInfo, website, lastUpdated ('2026-04-10'), tags (Array von Strings).
5. Gib NUR die JavaScript-Objekte zurück (keine Erklärungen, kein Code-Block-Wrapper), getrennt durch Kommas und Leerzeile.

Beispiel-Format:
  {{
    id: 30,
    name: 'Beispiel Hostel',
    category: '{category}',
    address: 'Musterstraße 1',
    district: '1010 Wien',
    lat: 48.2083,
    lng: 16.3731,
    description: 'Tolles Budget-Hostel im Zentrum.',
    priceInfo: 'Ab ~15 € / Nacht',
    website: 'https://example.com',
    lastUpdated: '2026-04-10',
    tags: ['günstig', 'zentral']
  }},
  {{
    id: 31,
    name: 'Weiteres Beispiel',
    category: '{category}',
    address: 'Musterstraße 2',
    district: '1010 Wien',
    lat: 48.2084,
    lng: 16.3732,
    description: 'Noch ein tolles Budget-Hostel.',
    priceInfo: 'Ab ~20 € / Nacht',
    website: 'https://example.com/2',
    lastUpdated: '2026-04-10',
    tags: ['günstig', 'ruhig']
  }}"""

    max_retries = 3
    for attempt in range(max_retries):
        try:
            response = client.chat.completions.create(
                model="llama-3.3-70b-versatile",
                messages=[{"role": "user", "content": prompt}],
                max_tokens=4000,
                temperature=0.3,
            )
            
            result = response.choices[0].message.content.strip()
            
            # Remove markdown code fences if present
            if result.startswith("```"):
                result = "\n".join(result.split("\n")[1:])
            if result.endswith("```"):
                result = "\n".join(result.split("\n")[:-1])
            
            return result.strip()
            
        except Exception as e:
            if "Rate limit" in str(e) or "429" in str(e):
                if attempt < max_retries - 1:
                    wait_time = 15.0 * (attempt + 1)
                    match = re.search(r'try again in (\d+(?:\.\d+)?)s', str(e))
                    if match:
                        wait_time = float(match.group(1)) + 2.0
                        
                    print(f"  Warnung: Rate Limit erreicht. Warte {wait_time:.1f} Sekunden (Versuch {attempt + 1}/{max_retries})...")
                    time.sleep(wait_time)
                else:
                    print("  Fehler: Maximale Anzahl an Retries wegen Rate Limit erreicht.")
                    raise e
            else:
                raise e

# ── Main ─────────────────────────────────────────────────────
if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(
        description='Automatischer Crawler für Wien Low Budget.',
        formatter_class=argparse.RawTextHelpFormatter
    )
    parser.add_argument('--category', type=str, default='unterkunft',
        help='Kategorie zum Aktualisieren (z.B. unterkunft, essen, museen).')
    parser.add_argument('--query', type=str, default=None,
        help='Suchanfrage für neue Optionen (optional, wird automatisch generiert).')
    parser.add_argument('--dry-run', action='store_true',
        help='Nur Vorschau anzeigen, data.js NICHT verändern.')
    
    args = parser.parse_args()
    
    # Auto-generate search query if not provided
    if not args.query:
        args.query = f'Wien {args.category} günstig site:1000things.at OR site:falter.at OR site:thefork.at OR site:tripadvisor.at OR site:wien.info'

    print(f"\n🕷️  Wien Low Budget – Automatischer Crawler")
    print(f"   Kategorie: {args.category}")
    print(f"   Modus: {'Dry Run (kein Speichern)' if args.dry_run else 'Live (speichert data.js)'}\n")

    # 1. Web Crawl
    web_context = crawl_web(args.query)

    # 2. Read current data
    try:
        category_entries, original_content, loc_start, loc_end = read_category_entries(DATA_JS_PATH, args.category)
        print(f"  -> Aktuelle Einträge für '{args.category}' gelesen.")
    except Exception as e:
        print(f"  Fehler beim Lesen von data.js: {e}")
        sys.exit(1)

    # 3. Plan with AI
    new_entries = plan_update(category_entries, args.category, web_context)

    if args.dry_run:
        print("\n" + "="*50)
        print("DRY RUN – Vorgeschlagene neue Einträge:")
        print("="*50)
        print(new_entries)
        print("="*50)
        print("\nKeine Änderungen gespeichert. Entferne --dry-run um zu speichern.")
    else:
        apply_update(DATA_JS_PATH, args.category, new_entries, original_content, loc_start, loc_end)
        print("\n✅ Fertig! Lade index.html neu um die Änderungen zu sehen.")
