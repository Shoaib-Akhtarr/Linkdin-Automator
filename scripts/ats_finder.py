#!/usr/bin/env python3
"""
Direct ATS Finder & Dorking Pipeline
Targets jobs directly on company career portals and ATS platforms
(Greenhouse, Ashby, Lever, Workday, SmartRecruiters, Jobvite, BambooHR).
"""

import os
import sys
import json
import csv
import re
import html
import time
import argparse
import urllib.request
import urllib.parse
import socket
socket.setdefaulttimeout(5)
try:
    sys.stdout.reconfigure(line_buffering=True)
except Exception:
    pass
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone

def utc_now_iso():
    return datetime.now(timezone.utc).isoformat()

# Path resolution
BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(BASE_DIR, "scripts"))
try:
    from tech_tracks import TECH_TRACKS, detect_track_from_profile
except ImportError:
    TECH_TRACKS = {}
    detect_track_from_profile = lambda p: "all"
DATA_DIR = os.path.join(BASE_DIR, "data")
CONFIG_DIR = os.path.join(BASE_DIR, "config")
COMPANIES_FILE = os.path.join(CONFIG_DIR, "companies.json")
PROFILE_FILE = os.path.join(CONFIG_DIR, "profile.json")
ATS_JOBS_FILE = os.path.join(DATA_DIR, "ats_jobs.json")
OUTPUT_CSV = os.path.join(DATA_DIR, "ats_discovered_jobs.csv")
OUTPUT_JSON = os.path.join(DATA_DIR, "ats_discovered_jobs.json")

USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"

# Dork Templates
ATS_DORK_CONFIGS = [
    {
        "platform": "Greenhouse",
        "domain": "boards.greenhouse.io",
        "query_template": 'site:boards.greenhouse.io ("{role}" OR "{skill}") ("{location}")',
        "normalize_fn": lambda u: re.sub(r'#.*$', '', u).rstrip('/') + '#app'
    },
    {
        "platform": "Lever",
        "domain": "jobs.lever.co",
        "query_template": 'site:jobs.lever.co ("{role}" OR "{skill}") ("{location}")',
        "normalize_fn": lambda u: (u.rstrip('/') + '/apply') if not u.endswith('/apply') else u
    },
    {
        "platform": "Ashby",
        "domain": "jobs.ashbyhq.com",
        "query_template": 'site:jobs.ashbyhq.com ("{role}" OR "{skill}") ("{location}")',
        "normalize_fn": lambda u: (u.rstrip('/') + '/application') if not u.endswith('/application') else u
    },
    {
        "platform": "Workday",
        "domain": "myworkdayjobs.com",
        "query_template": 'site:myworkdayjobs.com "{role}" "{location}"',
        "normalize_fn": lambda u: u
    },
    {
        "platform": "SmartRecruiters",
        "domain": "smartrecruiters.com",
        "query_template": 'site:smartrecruiters.com ("{role}" OR "{skill}") "{location}"',
        "normalize_fn": lambda u: u
    },
    {
        "platform": "Jobvite",
        "domain": "jobs.jobvite.com",
        "query_template": 'site:jobs.jobvite.com ("{role}" OR "{skill}") "{location}"',
        "normalize_fn": lambda u: u
    },
    {
        "platform": "BambooHR",
        "domain": "bamboohr.com",
        "query_template": 'site:*.bamboohr.com/careers ("{role}" OR "{skill}")',
        "normalize_fn": lambda u: u
    }
]


def load_json(filepath, default=None):
    if default is None:
        default = {}
    if os.path.exists(filepath):
        try:
            with open(filepath, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            print(f"[!] Warning reading {filepath}: {e}")
    return default


def clean_html(raw_html):
    if not raw_html:
        return ""
    # Unescape HTML entities first so &lt;div&gt; becomes <div>
    unescaped = html.unescape(raw_html)
    # Remove script and style elements
    clean = re.sub(r"<(script|style)[^>]*>[\s\S]*?</\1>", " ", unescaped, flags=re.IGNORECASE)
    # Strip HTML tags
    clean = re.sub(r"<[^>]*>", " ", clean)
    # Clean non-breaking spaces and normalize whitespace
    clean = clean.replace("\xa0", " ")
    return re.sub(r"\s+", " ", clean).strip()


# Strict Starter / Junior Guards
SENIORITY_EXCLUSIONS = [
    r'\bsenior\b', r'\bsr\.?\b', r'\bsr\s', r'\bstaff\b', r'\bprincipal\b',
    r'\blead\b', r'\bhead of\b', r'\bdirector\b', r'\bvp\b', r'\bvice president\b',
    r'\bmanager\b', r'\barchitect\b', r'\bchief\b', r'\bdistinguished\b',
    r'\blevel\s*(?:iii|iv|v|3|4|5)\b', r'\bl[5678]\b', r'\be[5678]\b'
]

STARTER_AFFIRMATIVE = [
    r'\bjunior\b', r'\bentry\b', r'\bassociate\b', r'\bintern\b', r'\binternship\b',
    r'\bgraduate\b', r'\bnew grad\b', r'\bfresher\b', r'\btrainee\b', r'\bapprentice\b',
    r'\bearly career\b', r'\bl1\b', r'\blevel\s*(?:1|i)\b'
]

# Countries requiring local citizenship / residency that exclude applicants from Pakistan
GEO_RESTRICTED_PATTERNS = [
    # US-only - all variations
    r'\bus\s*only\b', r'\busa\s*only\b', r'\bu\.s\.\s*only\b', r'\bunited states only\b',
    r'\bremote\s*-\s*us\b', r'\bremote\s*-\s*usa\b', r'\bremote\s*us\b', r'\bremote\s*usa\b',
    r'\bus\s*remote\b', r'\busa\s*remote\b', r'\bus,\s*remote\b', r'\bremote,\s*us\b',
    r'\bunited states\b', r'\bpst or est\b', r'\bpst/est\b', r'\bus:\s*pst\b', r'\btimezone\s*us\b',
    # Canada
    r'\bremote\s*canada\b', r'\bcanada\s*only\b', r'\bcanada\s*remote\b', r'\bremote,?\s*canada\b',
    # UK/EU/Germany/Poland
    r'\bremote\s*-?\s*uk\b', r'\buk\s*only\b', r'\bremote\s*-?\s*hybrid\s*uk\b',
    r'\bremote\s*poland\b', r'\bpoland\s*only\b',
    r'\bgermany\s*only\b', r'\beu\s*only\b', r'\bemea\s*only\b', r'\blatam\s*only\b',
    # Australia
    r'\baustralia\s*only\b', r'\bremote\s*australia\b',
    # Security restrictions
    r'\bsecurity clearance\b', r'\bts/sci\b', r'\bpolygraph\b',
]

# Region-only locations that restrict Pakistan (Americas = US/Canada/LATAM, EMEA = no APAC)
GEO_REGION_RESTRICTED_LOCS = [
    "americas", "north america", "emea", "latam",
    "united states", "usa", "canada", "united kingdom",
    "australia", "germany", "france", "netherlands", "poland",
]


# Dynamic Profile Seniority & Experience Evaluator
EXECUTIVE_EXCLUSIONS = [
    r'\bprincipal\b', r'\bdistinguished\b', r'\bdirector\b', r'\bvp\b',
    r'\bvice president\b', r'\bchief\b', r'\bhead of\b'
]

def get_candidate_seniority_tier(profile_data=None):
    if not profile_data:
        profile_data = load_json(PROFILE_FILE, {})
    exp = profile_data.get("workExperienceYears", {})
    total = exp.get("total", exp.get("default", 2))
    try:
        total_yrs = float(total)
    except (ValueError, TypeError):
        total_yrs = 2.0
    
    if total_yrs >= 5.0:
        return "senior", total_yrs
    elif total_yrs > 2.0:
        return "mid", total_yrs
    else:
        return "junior", total_yrs

def matches_filters(title, description, location, roles, skills, remote_only=True, profile_data=None):
    title_lower = (title or "").lower().strip()
    desc_lower = (description or "").lower()
    loc_lower = (location or "").lower().strip()
    text = f"{title_lower} {desc_lower} {loc_lower}"

    # Determine seniority dynamically from candidate profile
    tier, total_yrs = get_candidate_seniority_tier(profile_data)

    has_seniority = any(re.search(rx, title_lower) for rx in SENIORITY_EXCLUSIONS)
    has_starter = any(re.search(rx, title_lower) for rx in STARTER_AFFIRMATIVE)

    # ── 1. DYNAMIC SENIORITY GATE ──
    if tier == "junior":
        # Reject Senior/Staff/Lead unless marked junior/intern
        if has_seniority and not has_starter:
            return False
        # Reject if description demands 4+ years experience
        exp_matches = re.findall(r'(\d+)\+?\s*(?:to|-)?\s*(?:\d+)?\+?\s*years?\s*(?:of)?\s*(?:experience|exp)', desc_lower[:1500])
        for exp_str in exp_matches:
            try:
                yrs = int(exp_str)
                if yrs >= 4 and not has_starter:
                    return False
            except ValueError:
                pass
    elif tier == "senior":
        # Candidate has 5+ years: reject entry/intern roles, allow senior/staff/principal
        if has_starter and not has_seniority:
            return False
    elif tier == "mid":
        # Mid-level: reject pure intern/apprentice AND reject principal/executive
        if has_starter:
            return False
        if any(re.search(rx, title_lower) for rx in EXECUTIVE_EXCLUSIONS):
            return False

    # ── 2. GEOGRAPHIC RESTRICTION GATE ──
    # Check if the location is explicitly globally open
    is_globally_open = any(k in loc_lower for k in [
        "worldwide", "global", "anywhere", "all locations", "apac",
        "pakistan", "work from anywhere", "fully remote"
    ])

    if not is_globally_open:
        # Check exact location against restricted regions
        loc_stripped = re.sub(r'[^a-z\s]', '', loc_lower).strip()
        for region in GEO_REGION_RESTRICTED_LOCS:
            if loc_stripped == region or loc_lower == region:
                return False
            # Also block patterns like "Remote - Americas", "Remote (Americas)"
            if re.search(rf'\bremote\b.{{0,15}}\b{re.escape(region)}\b', loc_lower):
                return False
            if re.search(rf'\b{re.escape(region)}\b.{{0,15}}\bremote\b', loc_lower):
                return False

        # Apply regex patterns
        for geo_rx in GEO_RESTRICTED_PATTERNS:
            if re.search(geo_rx, loc_lower) or re.search(geo_rx, title_lower):
                return False

    # ── 3. ROLE MATCHING ──
    role_match = any(r.lower() in title_lower for r in roles) if roles else True
    if not role_match:
        skill_in_title = any(s.lower() in title_lower for s in skills)
        if not skill_in_title:
            return False

    # ── 4. SKILL MATCHING ──
    if skills:
        skill_match = any(s.lower() in text for s in skills)
        if not skill_match:
            return False

    # ── 5. REMOTE CHECK ──
    if remote_only:
        loc_text = f"{loc_lower} {title_lower}"
        is_remote = any(k in loc_text for k in ["remote", "anywhere", "worldwide", "distributed", "virtual"])
        if not is_remote:
            if not any(k in desc_lower[:400] for k in ["fully remote", "100% remote", "work from anywhere", "remote role"]):
                return False

    return True


def fetch_greenhouse_company(company, roles, skills, remote_only):
    slug = company.get("slug")
    name = company.get("name", slug)
    url = f"https://boards-api.greenhouse.io/v1/boards/{slug}/jobs?content=true"
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    
    jobs = []
    try:
        with urllib.request.urlopen(req, timeout=8) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            for item in data.get("jobs", []):
                title = (item.get("title") or "").strip()
                loc_name = (item.get("location") or {}).get("name") or "Unspecified"
                desc = clean_html(item.get("content") or "")
                
                if matches_filters(title, desc, loc_name, roles, skills, remote_only):
                    job_url = item.get("absolute_url")
                    apply_url = re.sub(r"#.*$", "", job_url).rstrip("/") + "#app"
                    jobs.append({
                        "jobId": f"gh_{slug}_{item.get('id')}",
                        "platform": "greenhouse",
                        "company": name,
                        "companySlug": slug,
                        "title": title,
                        "location": loc_name,
                        "workplaceType": "remote" if "remote" in loc_name.lower() else "unspecified",
                        "url": job_url,
                        "applyUrl": apply_url,
                        "description": desc[:1500],
                        "source": f"Greenhouse Direct ({name})",
                        "postedAt": item.get("updated_at") or utc_now_iso()
                    })
    except Exception:
        pass
    return jobs


def fetch_ashby_company(company, roles, skills, remote_only):
    slug = company.get("slug")
    name = company.get("name", slug)
    url = f"https://api.ashbyhq.com/posting-api/job-board/{slug}"
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    
    jobs = []
    try:
        with urllib.request.urlopen(req, timeout=8) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            for item in data.get("jobs", []):
                title = (item.get("title") or "").strip()
                loc_name = item.get("location") or "Remote"
                is_remote = item.get("isRemote", False) or "remote" in loc_name.lower()
                desc = clean_html(item.get("descriptionHtml") or item.get("descriptionPlain") or "")
                
                if matches_filters(title, desc, loc_name, roles, skills, remote_only):
                    job_url = item.get("jobUrl") or item.get("applyUrl") or f"https://jobs.ashbyhq.com/{slug}/{item.get('id')}"
                    apply_url = (job_url.rstrip("/") + "/application") if not job_url.endswith("/application") else job_url
                    jobs.append({
                        "jobId": f"ashby_{slug}_{item.get('id')}",
                        "platform": "ashby",
                        "company": name,
                        "companySlug": slug,
                        "title": title,
                        "location": loc_name,
                        "workplaceType": "remote" if is_remote else "onsite",
                        "url": job_url,
                        "applyUrl": apply_url,
                        "description": desc[:1500],
                        "source": f"Ashby Direct ({name})",
                        "postedAt": item.get("publishedAt") or utc_now_iso()
                    })
    except Exception:
        pass
    return jobs


def fetch_lever_company(company, roles, skills, remote_only):
    slug = company.get("slug")
    name = company.get("name", slug)
    jobs = []
    
    for base_url in [f"https://api.lever.co/v0/postings/{slug}?mode=json", f"https://api.eu.lever.co/v0/postings/{slug}?mode=json"]:
        try:
            req = urllib.request.Request(base_url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=8) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                if not isinstance(data, list):
                    continue
                for item in data:
                    title = (item.get("text") or "").strip()
                    cats = item.get("categories") or {}
                    loc_name = cats.get("location") or "Unspecified"
                    workplace = (item.get("workplaceType") or "unspecified").lower()
                    desc = clean_html(item.get("descriptionPlain") or item.get("description") or "")
                    
                    if matches_filters(title, desc, loc_name, roles, skills, remote_only):
                        job_url = item.get("hostedUrl") or item.get("applyUrl")
                        apply_url = (job_url.rstrip("/") + "/apply") if not job_url.endswith("/apply") else job_url
                        jobs.append({
                            "jobId": f"lever_{slug}_{item.get('id')}",
                            "platform": "lever",
                            "company": name,
                            "companySlug": slug,
                            "title": title,
                            "location": loc_name,
                            "workplaceType": workplace,
                            "url": job_url,
                            "applyUrl": apply_url,
                            "description": desc[:1500],
                            "source": f"Lever Direct ({name})",
                            "postedAt": datetime.fromtimestamp(item.get("createdAt", time.time()*1000)/1000).isoformat() if item.get("createdAt") else utc_now_iso()
                        })
                if jobs:
                    break
        except Exception:
            continue
    return jobs


def scan_all_curated_companies(companies, roles, skills, remote_only=True, max_workers=20):
    print(f"\n[*] Scanning {len(companies)} curated tech & AI company ATS endpoints in parallel...")
    all_jobs = []
    
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {}
        for comp in companies:
            if not comp.get("enabled", True):
                continue
            slug = (comp.get("slug") or "").lower()
            if slug in TOP_GIANTS_BLACKLIST:
                continue
            ats = comp.get("ats", "").lower()
            if ats == "greenhouse":
                f = executor.submit(fetch_greenhouse_company, comp, roles, skills, remote_only)
            elif ats == "ashby":
                f = executor.submit(fetch_ashby_company, comp, roles, skills, remote_only)
            elif ats == "lever":
                f = executor.submit(fetch_lever_company, comp, roles, skills, remote_only)
            else:
                continue
            futures[f] = comp.get("name")
        
        for f in as_completed(futures):
            comp_name = futures[f]
            try:
                res = f.result()
                if res:
                    print(f"  [+] {comp_name}: Found {len(res)} matching role(s)")
                    all_jobs.extend(res)
            except Exception as e:
                pass

    return all_jobs


def generate_google_dork_links(roles, skills, location="Remote", timeframe="past_24h"):
    """
    Builds Google Search Dork URLs with timeframe filters:
    &tbs=qdr:d (past 24h), &tbs=qdr:w (past week), &tbs=qdr:m (past month)
    """
    time_map = {
        "past_24h": "qdr:d",
        "past_week": "qdr:w",
        "past_month": "qdr:m",
        "all": ""
    }
    tbs = time_map.get(timeframe, "qdr:w")
    primary_role = roles[0] if roles else "AI Engineer"
    primary_skill = skills[0] if skills else "Python"
    
    dorks = []
    for cfg in ATS_DORK_CONFIGS:
        query = cfg["query_template"].format(
            role=primary_role,
            skill=primary_skill,
            location=location
        )
        params = {"q": query}
        if tbs:
            params["tbs"] = tbs
        google_url = "https://www.google.com/search?" + urllib.parse.urlencode(params)
        dorks.append({
            "platform": cfg["platform"],
            "query": query,
            "google_url": google_url
        })
    return dorks


def export_jobs(jobs, csv_path=OUTPUT_CSV, json_path=OUTPUT_JSON):
    os.makedirs(DATA_DIR, exist_ok=True)
    
    # Save JSON
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump({"total": len(jobs), "scanned_at": utc_now_iso(), "jobs": jobs}, f, indent=2)
    print(f"\n[✓] Exported {len(jobs)} jobs to JSON: {json_path}")
    
    # Save CSV
    if jobs:
        keys = ["jobId", "platform", "company", "title", "location", "workplaceType", "applyUrl", "url", "source", "postedAt"]
        with open(csv_path, "w", encoding="utf-8", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=keys, extrasaction="ignore")
            writer.writeheader()
            for j in jobs:
                writer.writerow(j)
        print(f"[✓] Exported {len(jobs)} jobs to CSV: {csv_path}")



# ═══════════════════════════════════════════════════════════════════════
# AUTO-DISCOVERY ENGINE  — Grows your company database every daily run
#
# How it works:
#  1. For each ATS platform (Ashby, Greenhouse, Lever), it fetches the
#     live job listing pages and extracts company slugs from job URLs.
#  2. Any slug NOT already in companies.json is a brand-new company.
#  3. It filters by entry-level/junior keywords to find starter-friendly
#     companies (those hiring junior/associate/graduate talent).
#  4. It appends them to companies.json automatically as tier:"discovered"
#     so the next daily run will scan them for jobs too.
#
# Your company pool GROWS every single day without any manual work.
# ═══════════════════════════════════════════════════════════════════════

TOP_GIANTS_BLACKLIST = {
    # Big Tech & Unicorns
    'anthropic', 'openai', 'figma', 'stripe', 'notion', 'scaleai', 'scale-ai',
    'databricks', 'cloudflare', 'snowflake', 'gitlab', 'datadog', 'spotify', 'hubspot',
    'coinbase', 'crowdstrike', 'canva', 'postman', 'snyk', 'wiz', 'verkada', '1password',
    'miro', 'airtable', 'mongodb', 'elastic', 'kong', 'palantir', 'meta', 'google', 'amazon',
    'apple', 'microsoft', 'netflix', 'uber', 'lyft', 'airbnb', 'tiktok', 'bytedance',
    # Companies that slipped through before
    'quora', 'ziprecruiter', 'affirm', 'shield', 'anduril', 'andurilindustries', 'purestorage',
    'doordash', 'doordashusa', 'thenewyorktimes', 'point72', 'xai', 'lucidsoftware',
    'gofundme', 'graphcore', 'intersystems', 'sigmacomputing', 'voyagertechnologiesinc',
    'addepar1', 'clear', 'edmentum', 'bloomon', 'bis', 'weride', 'datalabusa', 'mytos',
    'crosscountry-consulting', 'patreon', 'persona', 'ibotta', 'crusoe', 'dandy', 'trainline',
    'skydio', 'georgian', 'astramechanica', 'reliable-robotics', 'oneethos', 'divergent',
    'parallel', 'capstoneinvestmentadvisors', 'fanaticscollectibles', 'stratolaunch', 'atoms',
    'gcmgrosvenor', 'pdtpartners', 'drivewealth', 'thealleninstitute', 'inversionspace',
    'jomboymedia', 'rendezvousrobotics', 'aquaticcapitalmanagement', 'asteraearlycareer2027',
    'newsbreak', 'idmeuniversityrecruiting', 'generalmatter', 'getbuilt', 'humaninterestswe1',
    'headlandstechnologiesllc', 'wonderschool', 'whatnot', 'sierra', 'handshake', 'fal-ai',
    'telus-digital', 'armadin', 'horizon3ai', 'f7d8749a-72d6-407c-bf98-292ea630c73a',
    # Defense / hardware companies not suitable for remote junior roles
    'swarmaero', 'brainco', 'aescape', 'morse-micro', 'stratolaunch', 'anduril',
    # Finance companies that only hire US residents
    'old-mission-capital', 'capstoneinvestmentadvisors', 'pdtpartners',
    # Gear/gaming hardware that doesn't do remote software
    'backbone-game',
    # Unicorns and Large Well-Known Companies (User requested ONLY small/local/starter companies)
    'supabase', 'elevenlabs', 'posthog', 'planetscale', 'sentry', 'linear', 'vercel',
    'clickhouse', 'grafana-labs', 'togetherai', 'mistralai', 'cohere', 'replit',
    'contentful', 'sanity', 'storyblok', 'livekit', 'stream', 'ably', 'pusher',
    'cloudinary', 'uploadcare', 'paddle', 'airbyte', 'dagster-labs', 'prefect',
    'singlestore', 'oxide-computer-company', 'readme', 'stoplight', 'ironclad',
    'deepgram', 'assemblyai', 'gradient', 'qumulo', 'resend', 'inngest', 'chalk',
    'knock', 'loops', 'stytch', 'courier', 'growthbook', 'highlight-run', 'axiom',
    'better-stack', 'checkly', 'modal-labs', 'render', 'railway', 'fly-io',
    'weaviate', 'qdrant', 'chroma', 'neon', 'xata', 'turso', 'prisma', 'hasura',
    'daily', 'bytebase', 'tinybird', 'merge', 'codat', 'gitbook', 'thirdweb',
    'cern', 'unicef', 'duckduckgo', 'duck-duck-go', 'datadog', 'imc-trading'
}

DISCOVERY_ENTRY_KEYWORDS = [
    "junior", "associate", "entry", "graduate", "intern", "trainee",
    "jr.", "jr ", "early career", "new grad", "fresher", "apprentice",
    "beginner", "level 1", "level i", "l1 ", "0-2 years", "0-1 year"
]

DISCOVERY_ROLE_KEYWORDS = [
    "engineer", "developer", "programmer", "backend", "frontend",
    "fullstack", "python", "ai", "ml", "software", "data", "devops"
]


def _fetch_url_text(url, timeout=8):
    try:
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "*/*"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.read().decode("utf-8", errors="ignore")
    except Exception:
        return ""


def discover_new_companies_from_live_boards(existing_slugs, roles, max_new=30):
    """
    Discovers fresh, small & starter-friendly tech startups from Hacker News
    and emerging open-source developer tool boards.
    Strictly filters out any giant corporations or enterprise defense firms.
    """
    print("\n[🔍] AUTO-DISCOVERY: Checking live feeds for fresh starter-friendly startups...")
    new_companies = []
    seen_slugs = set(existing_slugs) | TOP_GIANTS_BLACKLIST

    # 1. Discover from Hacker News "Who is Hiring" items if available
    hn_file = os.path.join(DATA_DIR, "hn_discovered_jobs.json")
    if os.path.exists(hn_file):
        try:
            with open(hn_file, "r", encoding="utf-8") as f:
                hn_data = json.load(f)
            for j in (hn_data.get("jobs") or []):
                text = f"{j.get('applyUrl', '')} {j.get('url', '')} {j.get('description', '')}"
                for pattern, ats_type in [
                    (r'jobs\.ashbyhq\.com/([a-zA-Z0-9_\-]+)', 'ashby'),
                    (r'boards\.greenhouse\.io/([a-zA-Z0-9_\-]+)', 'greenhouse'),
                    (r'jobs\.lever\.co/([a-zA-Z0-9_\-]+)', 'lever')
                ]:
                    for m in re.finditer(pattern, text):
                        slug = m.group(1).lower()
                        if slug and slug not in seen_slugs and slug not in ["api", "application", "jobs", "embed"]:
                            seen_slugs.add(slug)
                            c_name = j.get("company", "").strip() or slug.replace("-", " ").title()
                            if len(c_name) > 35: c_name = slug.replace("-", " ").title()
                            new_companies.append({
                                "name": c_name,
                                "slug": slug,
                                "ats": ats_type,
                                "category": "Starter / HN Discovered",
                                "tier": "starter",
                                "enabled": True,
                                "discoveredAt": utc_now_iso()
                            })
                            print(f"  [+] {ats_type.upper()} NEW STARTUP: {c_name} ({slug})")
                            if len(new_companies) >= max_new:
                                break
        except Exception:
            pass

    return new_companies

    return new_companies


def save_discovered_companies(new_companies):
    """
    Appends newly discovered companies to config/companies.json.
    Skips duplicates by slug. This is the core of the self-growing engine.
    """
    if not new_companies:
        print("  [i] No new companies discovered this run.")
        return

    existing = []
    if os.path.exists(COMPANIES_FILE):
        try:
            with open(COMPANIES_FILE, "r", encoding="utf-8") as f:
                existing = json.load(f)
        except Exception:
            existing = []

    existing_slugs = {c.get("slug", "").lower() for c in existing}
    added = []
    for c in new_companies:
        if c.get("slug", "").lower() not in existing_slugs:
            existing.append(c)
            existing_slugs.add(c["slug"].lower())
            added.append(c["name"])

    with open(COMPANIES_FILE, "w", encoding="utf-8") as f:
        json.dump(existing, f, indent=2, ensure_ascii=False)

    print(f"\n[✓] AUTO-DISCOVERY COMPLETE: {len(added)} new companies added to companies.json")
    if added:
        print(f"    New entries: {', '.join(added[:10])}" + (" ..." if len(added) > 10 else ""))
    print(f"    Total companies in database: {len(existing)}")


def sync_with_ats_jobs(discovered_jobs):
    """
    Syncs newly discovered jobs into the main pipeline ledger (data/ats_jobs.json)
    so the existing engine/orchestrator can apply to them automatically!
    """
    existing_data = load_json(ATS_JOBS_FILE, {"lastScanTime": None, "jobs": []})
    existing_jobs = existing_data.get("jobs", [])
    seen_ids = {j.get("jobId") for j in existing_jobs}
    
    added_count = 0
    for j in discovered_jobs:
        if j.get("jobId") not in seen_ids:
            j["status"] = "PENDING_APPROVAL"
            j["scannedAt"] = utc_now_iso()
            existing_jobs.append(j)
            seen_ids.add(j.get("jobId"))
            added_count += 1
            
    existing_data["jobs"] = existing_jobs
    existing_data["lastScanTime"] = utc_now_iso()
    
    with open(ATS_JOBS_FILE, "w", encoding="utf-8") as f:
        json.dump(existing_data, f, indent=2)
        
    print(f"[✓] Pipeline Synchronized: {added_count} new job(s) added to {ATS_JOBS_FILE}")


def main():
    parser = argparse.ArgumentParser(description="Direct ATS Job Finder & Dorking Scraper")
    parser.add_argument("--track", type=str, default="auto", choices=["auto", "all", "devops", "dotnet", "webdev", "backend", "fullstack", "mobile", "data", "qa", "security", "ai"], help="Target tech track")
    parser.add_argument("--roles", type=str, default=None, help="Comma-separated target roles (overrides track)")
    parser.add_argument("--skills", type=str, default=None, help="Comma-separated required skills (overrides track)")
    parser.add_argument("--location", type=str, default="Remote", help="Location filter")
    parser.add_argument("--all-workplaces", action="store_true", help="Include on-site and hybrid roles")
    parser.add_argument("--timeframe", choices=["past_24h", "past_week", "past_month", "all"], default="past_week", help="Date filter for dorks")
    parser.add_argument("--show-dorks", action="store_true", help="Show Google Dork URLs")
    parser.add_argument("--open-dorks", action="store_true", help="Open Google Dork tabs in Chrome")
    parser.add_argument("--sync", action="store_true", help="Sync discovered jobs directly into the auto-apply pipeline")
    parser.add_argument("--no-discover", action="store_true", help="Skip the auto-discovery of new companies (use curated list only)")
    
    args = parser.parse_args()

    # Determine track from profile or flag
    profile_data = load_json(PROFILE_FILE, {})
    if args.track == "auto":
        selected_track = detect_track_from_profile(profile_data)
    else:
        selected_track = args.track

    if args.roles:
        roles = [r.strip() for r in args.roles.split(",") if r.strip()]
    elif selected_track in TECH_TRACKS:
        roles = TECH_TRACKS[selected_track]["roles"][:5]
    else:
        roles = ["Software Engineer", "Developer", "Engineer"]

    if args.skills:
        skills = [s.strip() for s in args.skills.split(",") if s.strip()]
    elif selected_track in TECH_TRACKS:
        skills = TECH_TRACKS[selected_track]["skills"][:5]
    else:
        skills = []

    remote_only = not args.all_workplaces
    
    print("=" * 70)
    print("🎯 DIRECT ATS JOB FINDER & DORKING PIPELINE")
    print("=" * 70)
    print(f"Roles:      {', '.join(roles)}")
    print(f"Skills:     {', '.join(skills)}")
    print(f"Location:   {args.location} (Remote-only: {remote_only})")
    print(f"Timeframe:  {args.timeframe}")
    print("=" * 70)

    # 1. Generate & Display ATS Google Dorks
    dork_links = generate_google_dork_links(roles, skills, args.location, args.timeframe)
    if args.show_dorks or args.open_dorks:
        print("\n🔍 --- ATS GOOGLE DORKING QUERIES ---")
        for d in dork_links:
            print(f"\n[{d['platform']}]")
            print(f"  Dork Query: {d['query']}")
            print(f"  Google URL: {d['google_url']}")
            
        if args.open_dorks:
            import webbrowser
            print("\n🌐 Opening Google Dork search tabs in browser...")
            for d in dork_links:
                webbrowser.open_new_tab(d["google_url"])

    # 2a. AUTO-DISCOVERY: Find brand-new starter-friendly companies from live ATS boards
    companies = load_json(COMPANIES_FILE, [])
    existing_slugs = [c.get("slug", "") for c in companies]
    if not args.no_discover:
        new_companies = discover_new_companies_from_live_boards(existing_slugs, roles, max_new=30)
        if new_companies:
            save_discovered_companies(new_companies)
            # Reload so the scan below includes freshly discovered companies
            companies = load_json(COMPANIES_FILE, [])
    else:
        print("\n[i] Auto-discovery skipped (--no-discover flag set). Using curated list only.")

    # 2b. Parallel Direct Company ATS Harvester (now includes newly discovered ones)
    discovered = scan_all_curated_companies(companies, roles, skills, remote_only=remote_only)
    
    print("\n" + "=" * 70)
    print(f"📊 SUMMARY: Discovered {len(discovered)} direct ATS opportunities")
    print("=" * 70)
    
    if discovered:
        for i, j in enumerate(discovered[:10], 1):
            print(f"{i:2d}. [{j['platform'].upper():10s}] {j['company']:18s} | {j['title']} ({j['location']})")
            print(f"    Apply: {j['applyUrl']}")
        if len(discovered) > 10:
            print(f"    ... and {len(discovered) - 10} more.")
            
        export_jobs(discovered)
        
        if args.sync:
            sync_with_ats_jobs(discovered)
        else:
            print("\n[i] Tip: Run with `--sync` to automatically send these jobs into the AutoApply queue.")
    else:
        print("No matching jobs found with the current filters.")


if __name__ == "__main__":
    main()
