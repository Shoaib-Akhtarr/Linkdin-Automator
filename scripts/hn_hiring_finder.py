#!/usr/bin/env python3
"""
Universal Hacker News "Who is Hiring?" Job Harvester
Fetches and categorizes direct tech job openings from the monthly Hacker News hiring threads.
Extracts direct founder/CTO emails, company ATS application links, and stack details
for any tech domain (DevOps, .NET, Web Dev, Backend, Full Stack, Mobile, Data, QA, Security, AI).
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
from datetime import datetime, timezone

try:
    sys.stdout.reconfigure(line_buffering=True)
except Exception:
    pass

# Import Tech Tracks definition
BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(BASE_DIR, "scripts"))
try:
    from tech_tracks import TECH_TRACKS, detect_track_from_profile, match_job_track, get_track_highlight
except ImportError:
    TECH_TRACKS = {}
    detect_track_from_profile = lambda p: "all"
    match_job_track = lambda t, d, s, r: (True, [])
    get_track_highlight = lambda t, h=None: "scalable software systems and cloud architectures"

try:
    from ats_finder import TOP_GIANTS_BLACKLIST, SENIORITY_EXCLUSIONS, STARTER_AFFIRMATIVE, GEO_RESTRICTED_PATTERNS, EXECUTIVE_EXCLUSIONS, get_candidate_seniority_tier
except ImportError:
    TOP_GIANTS_BLACKLIST = set()
    SENIORITY_EXCLUSIONS = []
    STARTER_AFFIRMATIVE = []
    GEO_RESTRICTED_PATTERNS = []
    EXECUTIVE_EXCLUSIONS = []
    get_candidate_seniority_tier = lambda p=None: ("junior", 2.0)

DATA_DIR = os.path.join(BASE_DIR, "data")
CONFIG_DIR = os.path.join(BASE_DIR, "config")
PROFILE_FILE = os.path.join(CONFIG_DIR, "profile.json")
ATS_JOBS_FILE = os.path.join(DATA_DIR, "ats_jobs.json")
OUTPUT_JSON = os.path.join(DATA_DIR, "hn_discovered_jobs.json")
OUTPUT_CSV = os.path.join(DATA_DIR, "hn_discovered_jobs.csv")

USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"


def utc_now_iso():
    return datetime.now(timezone.utc).isoformat()


def load_json(filepath, default=None):
    if default is None:
        default = {}
    if os.path.exists(filepath):
        try:
            with open(filepath, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return default


def clean_html_text(raw_html):
    if not raw_html:
        return ""
    unescaped = html.unescape(raw_html)
    # Convert paragraph tags to linebreaks
    text = re.sub(r'</?(p|br|div|tr|li)[^>]*>', '\n', unescaped, flags=re.IGNORECASE)
    # Strip remaining HTML tags
    text = re.sub(r'<[^>]*>', ' ', text)
    # Normalize excessive spaces
    lines = [re.sub(r'[ \t]+', ' ', line).strip() for line in text.split('\n')]
    return '\n'.join([l for l in lines if l])


def extract_emails(text):
    if not text:
        return []
    # Standard email regex, filter out sample/noreply domains
    candidates = re.findall(r'[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+', text)
    valid = []
    ignored = {"example.com", "domain.com", "email.com", "ycombinator.com", "w3.org"}
    for c in candidates:
        domain = c.split('@')[-1].lower()
        if domain not in ignored and not c.startswith("user@"):
            valid.append(c)
    return list(dict.fromkeys(valid))


def extract_urls(text):
    if not text:
        return []
    urls = re.findall(r'https?://[^\s<>"\')]+', text)
    cleaned = []
    for u in urls:
        # Strip trailing punctuation
        u = re.sub(r'[.,;:]+$', '', u)
        if "ycombinator.com" not in u and "news.ycombinator.com" not in u:
            cleaned.append(u)
    return list(dict.fromkeys(cleaned))


def find_latest_hn_threads(limit=1):
    """
    Queries Algolia Search API for the latest 'Ask HN: Who is hiring?' threads.
    """
    url = f"https://hn.algolia.com/api/v1/search_by_date?tags=story,author_whoishiring&query=Who+is+hiring&hitsPerPage=10"
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    
    threads = []
    try:
        with urllib.request.urlopen(req, timeout=12) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            for hit in data.get("hits", []):
                title = hit.get("title") or ""
                if "Who is hiring?" in title and not "Who wants to be hired" in title:
                    threads.append({
                        "id": hit.get("objectID"),
                        "title": title,
                        "created_at": hit.get("created_at"),
                        "num_comments": hit.get("num_comments", 0)
                    })
                    if len(threads) >= limit:
                        break
    except Exception as e:
        print(f"[!] Error fetching HN hiring threads: {e}")
        
    return threads


def parse_hn_posting(child, thread_title=""):
    """
    Parses a single top-level HN comment into a structured job entry.
    """
    raw_text = child.get("text") or ""
    if not raw_text:
        return None

    comment_id = child.get("id")
    author = child.get("author") or "hn_user"
    clean_text = clean_html_text(raw_text)
    first_line = clean_text.split("\n")[0] if clean_text else ""

    # HN header format typically: Company | Role | Location | Workplace / Compensation
    # Sometimes separated by |, /, or -
    tokens = [t.strip() for t in re.split(r'\||\s{2,}-\s{2,}|\s{2,}—\s{2,}', first_line) if t.strip()]

    company = tokens[0] if len(tokens) > 0 else author
    title = tokens[1] if len(tokens) > 1 else "Software Engineer"
    location = tokens[2] if len(tokens) > 2 else "Unspecified"

    # Identify workplace type
    full_lower = clean_text.lower()
    is_remote = any(k in full_lower for k in ["remote", "worldwide", "anywhere", "distributed", "telecommute", "work from home"])
    is_hybrid = "hybrid" in full_lower
    is_onsite = ("onsite" in full_lower or "on-site" in full_lower) and not is_remote

    if is_remote and is_hybrid:
        workplace_type = "hybrid / remote"
    elif is_remote:
        workplace_type = "remote"
    elif is_hybrid:
        workplace_type = "hybrid"
    elif is_onsite:
        workplace_type = "onsite"
    else:
        workplace_type = "unspecified"

    # Extract salary if mentioned
    salary_match = re.search(r'([$€£]\s?\d{2,3}(?:[,\.]\d{3})*(?:\s?k)?(?:\s?-\s?[$€£]?\s?\d{2,3}(?:[,\.]\d{3})*(?:\s?k)?)?(?:\s?/\s?(?:yr|year|hr|hour|mo|month))?)', clean_text, re.IGNORECASE)
    salary = salary_match.group(0).strip() if salary_match else "Unspecified"

    # Extract emails and URLs
    emails = extract_emails(clean_text)
    contact_email = emails[0] if emails else ""

    urls = extract_urls(clean_text)
    
    # Check for direct ATS links (Greenhouse, Ashby, Lever, Workday)
    ats_url = ""
    for u in urls:
        if any(dom in u for dom in ["greenhouse.io", "ashbyhq.com", "lever.co", "myworkdayjobs.com", "smartrecruiters.com", "jobvite.com"]):
            ats_url = u
            break
            
    apply_url = ats_url if ats_url else (urls[0] if urls else f"https://news.ycombinator.com/item?id={comment_id}")
    hn_post_url = f"https://news.ycombinator.com/item?id={comment_id}"

    # Clean up company & title strings
    company = re.sub(r'^(We are|We\'re|At)\s+', '', company, flags=re.IGNORECASE).strip()
    if len(company) > 60:
        company = company[:60]
    if len(title) > 90:
        title = title[:90]

    return {
        "jobId": f"hn_{comment_id}",
        "platform": "hackernews",
        "company": company,
        "title": title,
        "location": location,
        "workplaceType": workplace_type,
        "salary": salary,
        "contactEmail": contact_email,
        "allEmails": emails,
        "url": hn_post_url,
        "applyUrl": apply_url,
        "hasDirectAts": bool(ats_url),
        "source": f"Hacker News ({thread_title})",
        "author": author,
        "description": clean_text[:2000],
        "postedAt": child.get("created_at") or utc_now_iso()
    }


def fetch_thread_jobs(story_id, thread_title, selected_track="all", remote_only=True, keywords=None):
    """
    Fetches all postings under a Who is Hiring thread and filters by tech track.
    """
    url = f"https://hn.algolia.com/api/v1/items/{story_id}"
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})

    jobs = []
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            children = data.get("children", [])
            print(f"[*] Processing {len(children)} total postings from: {thread_title}...")

            for c in children:
                item = parse_hn_posting(c, thread_title)
                if not item:
                    continue

                # Blacklist and noise gate
                comp_lower = item["company"].lower().strip()
                if any(b in comp_lower for b in TOP_GIANTS_BLACKLIST):
                    continue
                if any(re.search(p, comp_lower) for p in [r'^location:', r'^apply here:', r'no longer taking', r'seeking freelance', r'seeking work', r'who\'s hiring a']):
                    continue

                # Dynamic Profile Seniority Gate
                tier, total_yrs = get_candidate_seniority_tier(load_json(PROFILE_FILE, {}))
                title_lower = item["title"].lower()
                has_seniority = any(re.search(rx, title_lower) for rx in SENIORITY_EXCLUSIONS)
                has_starter = any(re.search(rx, title_lower) for rx in STARTER_AFFIRMATIVE)

                if tier == "junior":
                    if has_seniority and not has_starter:
                        continue
                elif tier == "senior":
                    if has_starter and not has_seniority:
                        continue
                elif tier == "mid":
                    if has_starter:
                        continue
                    if any(re.search(rx, title_lower) for rx in EXECUTIVE_EXCLUSIONS):
                        continue

                # Geographic gate (reject US/EU/UK/Americas restricted)
                loc_lower = item["location"].lower()
                if any(re.search(rx, loc_lower) for rx in GEO_RESTRICTED_PATTERNS) or any(re.search(rx, title_lower) for rx in GEO_RESTRICTED_PATTERNS):
                    continue

                # Filter by tech track
                matches, matched_tracks = match_job_track(
                    item["title"],
                    item["description"],
                    selected_track=selected_track,
                    remote_only=remote_only
                )

                if not matches:
                    continue

                # Optional keyword filter
                if keywords:
                    desc_lower = item["description"].lower()
                    if not any(k.lower() in desc_lower for k in keywords):
                        continue

                item["matchedTracks"] = matched_tracks
                jobs.append(item)

    except Exception as e:
        print(f"[!] Error reading thread {story_id}: {e}")

    return jobs


def sync_with_ats_pipeline(jobs):
    """
    Syncs the discovered HN jobs into data/ats_jobs.json for automated apply & tracking.
    """
    existing_data = load_json(ATS_JOBS_FILE, {"lastScanTime": None, "jobs": []})
    existing_jobs = existing_data.get("jobs", [])
    seen_ids = {j.get("jobId") for j in existing_jobs}

    added_count = 0
    for j in jobs:
        if j.get("jobId") not in seen_ids:
            j["status"] = "PENDING_APPROVAL"
            j["scannedAt"] = utc_now_iso()
            existing_jobs.append(j)
            seen_ids.add(j.get("jobId"))
            added_count += 1

    existing_data["jobs"] = existing_jobs
    existing_data["lastScanTime"] = utc_now_iso()

    os.makedirs(os.path.dirname(ATS_JOBS_FILE), exist_ok=True)
    with open(ATS_JOBS_FILE, "w", encoding="utf-8") as f:
        json.dump(existing_data, f, indent=2)

    print(f"\n[✓] Pipeline Synchronized: {added_count} new HN job(s) added to {ATS_JOBS_FILE}")


def export_results(jobs):
    os.makedirs(DATA_DIR, exist_ok=True)

    # JSON export
    with open(OUTPUT_JSON, "w", encoding="utf-8") as f:
        json.dump({"total": len(jobs), "scanned_at": utc_now_iso(), "jobs": jobs}, f, indent=2)
    print(f"[✓] Saved {len(jobs)} jobs to JSON: {OUTPUT_JSON}")

    # CSV export
    if jobs:
        keys = ["jobId", "company", "title", "location", "workplaceType", "salary", "contactEmail", "applyUrl", "url", "matchedTracks", "source"]
        with open(OUTPUT_CSV, "w", encoding="utf-8", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=keys, extrasaction="ignore")
            writer.writeheader()
            for j in jobs:
                row = dict(j)
                row["matchedTracks"] = ", ".join(j.get("matchedTracks", []))
                writer.writerow(row)
        print(f"[✓] Saved {len(jobs)} jobs to CSV: {OUTPUT_CSV}")


def print_summary_table(jobs, max_display=15):
    if not jobs:
        print("\n[!] No matching jobs found for current filters.")
        return

    print("\n" + "=" * 90)
    print(f"⚡ TOP MATCHED HACKER NEWS JOB OPENINGS (Showing up to {max_display} of {len(jobs)})")
    print("=" * 90)

    for i, j in enumerate(jobs[:max_display], 1):
        tracks_str = ", ".join(j.get("matchedTracks", [])).upper() or "TECH"
        email_info = f" | 📧 {j['contactEmail']}" if j.get("contactEmail") else ""
        ats_badge = " [ATS PORTAL]" if j.get("hasDirectAts") else ""

        print(f"\n{i}. 🏢 {j['company']}  [{tracks_str}]{ats_badge}")
        print(f"   💼 Role:      {j['title']}")
        print(f"   📍 Location:  {j['location']} ({j['workplaceType'].upper()}) | 💰 {j['salary']}{email_info}")
        print(f"   🔗 Apply/URL: {j['applyUrl']}")

    print("\n" + "=" * 90)


def auto_discover_companies_from_hn(jobs):
    """
    Extracts ATS company slugs (Ashby, Greenhouse, Lever) directly from HN postings
    and automatically registers new startup companies into config/companies.json.
    This expands the candidate's target company database day by day without manual work!
    """
    companies_file = os.path.join(CONFIG_DIR, "companies.json")
    existing_companies = load_json(companies_file, [])
    seen_slugs = {c.get("slug", "").lower() for c in existing_companies if isinstance(c, dict)}
    
    new_found = []
    for j in jobs:
        urls = [j.get("applyUrl", ""), j.get("url", "")] + (j.get("allEmails", []))
        desc = j.get("description", "")
        company_name = j.get("company", "").strip()
        
        # Search for Ashby, Greenhouse, Lever patterns in URLs & description
        all_text = " ".join(urls) + " " + desc
        
        # 1. Ashby
        ashby_matches = re.findall(r'jobs\.ashbyhq\.com/([a-zA-Z0-9_\-]+)', all_text)
        for slug in ashby_matches:
            slug = slug.lower()
            if slug and slug not in seen_slugs and slug not in ["api", "application", "jobs"] and slug not in TOP_GIANTS_BLACKLIST:
                seen_slugs.add(slug)
                display_name = company_name if company_name and len(company_name) < 40 else slug.replace("-", " ").title()
                new_found.append({
                    "name": display_name,
                    "slug": slug,
                    "ats": "ashby",
                    "category": "Discovered / HN Startup",
                    "tier": "starter",
                    "enabled": True,
                    "discoveredAt": utc_now_iso()
                })
                
        # 2. Greenhouse
        gh_matches = re.findall(r'boards\.greenhouse\.io/([a-zA-Z0-9_\-]+)', all_text)
        for slug in gh_matches:
            slug = slug.lower()
            if slug and slug not in seen_slugs and slug not in ["embed", "jobs"] and slug not in TOP_GIANTS_BLACKLIST:
                seen_slugs.add(slug)
                display_name = company_name if company_name and len(company_name) < 40 else slug.replace("-", " ").title()
                new_found.append({
                    "name": display_name,
                    "slug": slug,
                    "ats": "greenhouse",
                    "category": "Discovered / HN Startup",
                    "tier": "starter",
                    "enabled": True,
                    "discoveredAt": utc_now_iso()
                })
                
        # 3. Lever
        lever_matches = re.findall(r'jobs\.lever\.co/([a-zA-Z0-9_\-]+)', all_text)
        for slug in lever_matches:
            slug = slug.lower()
            if slug and slug not in seen_slugs and slug not in ["apply", "jobs"] and slug not in TOP_GIANTS_BLACKLIST:
                seen_slugs.add(slug)
                display_name = company_name if company_name and len(company_name) < 40 else slug.replace("-", " ").title()
                new_found.append({
                    "name": display_name,
                    "slug": slug,
                    "ats": "lever",
                    "category": "Discovered / HN Startup",
                    "tier": "starter",
                    "enabled": True,
                    "discoveredAt": utc_now_iso()
                })
                
    if new_found:
        existing_companies.extend(new_found)
        with open(companies_file, "w", encoding="utf-8") as f:
            json.dump(existing_companies, f, indent=2, ensure_ascii=False)
        print(f"\n[💡] SELF-GROWING PIPELINE: Discovered {len(new_found)} new startup companies from HN!")
        for nf in new_found[:5]:
            print(f"    + [{nf['ats'].upper()}] {nf['name']} ({nf['slug']})")
        if len(new_found) > 5:
            print(f"    ... and {len(new_found) - 5} more.")
        print(f"    Total active startup companies now: {len(existing_companies)}")


def main():
    parser = argparse.ArgumentParser(description="Universal Hacker News Who is Hiring Harvester")
    parser.add_argument(
        "--track",
        type=str,
        default="auto",
        choices=["auto", "all", "devops", "dotnet", "webdev", "backend", "fullstack", "mobile", "data", "qa", "security", "ai"],
        help="Tech track filter (default: auto-detect from profile.json)"
    )
    parser.add_argument("--all-workplaces", action="store_true", help="Include on-site and hybrid roles (default: remote-only)")
    parser.add_argument("--keywords", type=str, default="", help="Comma-separated optional keyword filter")
    parser.add_argument("--months", type=int, default=1, help="Number of past monthly threads to scan (default: 1)")
    parser.add_argument("--sync", action="store_true", help="Sync discovered jobs into the main auto-apply pipeline")
    
    args = parser.parse_args()

    # Determine track
    profile_data = load_json(PROFILE_FILE, {})
    if args.track == "auto":
        track = detect_track_from_profile(profile_data)
        detected_notice = f"Auto-detected '{track.upper()}' from candidate profile"
    else:
        track = args.track
        detected_notice = f"Manually selected '{track.upper()}'"

    remote_only = not args.all_workplaces
    keywords = [k.strip() for k in args.keywords.split(",") if k.strip()]

    print("=" * 80)
    print("🚀 UNIVERSAL HACKER NEWS 'WHO IS HIRING?' HARVESTER")
    print("=" * 80)
    print(f"Target Track:    {track.upper()} ({detected_notice})")
    print(f"Remote Filter:   {'Remote-Only' if remote_only else 'All Workplaces (Remote + On-site + Hybrid)'}")
    if keywords:
        print(f"Keywords:        {', '.join(keywords)}")
    print(f"Threads:         Past {args.months} monthly thread(s)")
    print("=" * 80)

    # Fetch latest thread(s)
    threads = find_latest_hn_threads(limit=args.months)
    if not threads:
        print("[!] No active 'Who is hiring?' threads found. Please check internet connection.")
        return

    all_jobs = []
    for t in threads:
        print(f"\n[+] Fetching thread: {t['title']} (ID: {t['id']})...")
        jobs = fetch_thread_jobs(
            story_id=t["id"],
            thread_title=t["title"],
            selected_track=track,
            remote_only=remote_only,
            keywords=keywords
        )
        all_jobs.extend(jobs)

    # Print summary and exports
    print_summary_table(all_jobs)
    export_results(all_jobs)

    # Auto-extract new companies to grow companies.json day by day
    auto_discover_companies_from_hn(all_jobs)

    if args.sync and all_jobs:
        sync_with_ats_pipeline(all_jobs)


if __name__ == "__main__":
    main()
