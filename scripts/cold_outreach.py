#!/usr/bin/env python3
"""
Step 2 Strategy: Universal Soft Touch Cold Outreach Generator
Generates high-response 3-sentence outreach messages for any tech role
(DevOps, .NET, Web Dev, Backend, Full Stack, Mobile, Data, QA, Security, AI).
Supports direct email drafting for Hacker News postings and 1-click decision maker links.
"""

import os
import sys
import json
import urllib.parse
import argparse

BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(BASE_DIR, "scripts"))
try:
    from tech_tracks import get_track_highlight, TECH_TRACKS
except ImportError:
    get_track_highlight = lambda title, hint=None: "scalable modern software systems, microservices, and reliable cloud deployments"
    TECH_TRACKS = {}

PROFILE_FILE = os.path.join(BASE_DIR, "config", "profile.json")
APPLICATIONS_FILE = os.path.join(BASE_DIR, "data", "applications.json")
DISCOVERED_ATS_FILE = os.path.join(BASE_DIR, "data", "ats_discovered_jobs.json")
DISCOVERED_HN_FILE = os.path.join(BASE_DIR, "data", "hn_discovered_jobs.json")


def load_json(path, default=None):
    if default is None:
        default = {}
    if os.path.exists(path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return default


def generate_notes(company, role, recipient="[Name]", email=None, candidate_name="Shoaib Akhtar"):
    highlight = get_track_highlight(role)

    # 1. EM / Lead Note
    em_note = (
        f"Hi {recipient}, saw the {role} posting on your team and just submitted my application. "
        f"I specialize in {highlight}, closely aligning with your stack. "
        f"Looking forward to hopefully connecting with the engineering team!"
    )

    # 2. Founder / CTO Note (Early stage & YC)
    founder_note = (
        f"Hi {recipient}, love what you're building at {company}—just applied for the {role} opening. "
        f"I bring deep hands-on experience in {highlight} and would love to help drive the product forward. "
        f"Excited to see the team continue to scale!"
    )

    # 3. Direct Email Draft (for Hacker News & direct contacts)
    email_subject = f"Application for {role} - {candidate_name}"
    email_body = (
        f"Hi {recipient},\n\n"
        f"I saw your posting on Hacker News for the {role} position at {company}.\n\n"
        f"My background centers on {highlight}. Given your stack and focus, I believe I could immediately contribute to your engineering goals.\n\n"
        f"I've attached my resume and would welcome the opportunity to discuss how my experience can support {company}.\n\n"
        f"Best regards,\n"
        f"{candidate_name}"
    )

    # Decision-maker search links
    enc = urllib.parse.quote(company)
    linkedin_url = f"https://www.linkedin.com/search/results/people/?keywords={enc}+%28%22Engineering+Manager%22+OR+%22Head+of+Engineering%22+OR+%22CTO%22+OR+%22Tech+Lead%22+OR+%22Founder%22%29"
    twitter_url = f"https://x.com/search?q={enc}+%28%22engineer%22+OR+%22founder%22+OR+%22CTO%22%29&f=user"

    return {
        "company": company,
        "role": role,
        "email": email,
        "em_note": em_note,
        "founder_note": founder_note,
        "email_subject": email_subject,
        "email_body": email_body,
        "linkedin_url": linkedin_url,
        "twitter_url": twitter_url
    }


def main():
    parser = argparse.ArgumentParser(description="Universal Soft Touch Cold Outreach Note Generator")
    parser.add_argument("--company", type=str, help="Company name (e.g. Simple Analytics, Datadog)")
    parser.add_argument("--role", type=str, help="Job title (e.g. DevOps Engineer, .NET Developer)")
    parser.add_argument("--email", type=str, help="Direct hiring email if known")
    parser.add_argument("--name", type=str, default="[Name]", help="Recipient's first name if known")
    parser.add_argument("--hn", action="store_true", help="Generate notes for recent Hacker News discovered jobs")
    parser.add_argument("--recent", action="store_true", help="Generate notes for the last 5 applied or discovered ATS jobs")
    args = parser.parse_args()

    profile = load_json(PROFILE_FILE, {})
    candidate_name = profile.get("personal", {}).get("fullName") or "Shoaib Akhtar"

    targets = []
    if args.company and args.role:
        targets.append({"company": args.company, "role": args.role, "email": args.email})
    elif args.hn:
        hn_data = load_json(DISCOVERED_HN_FILE, {}).get("jobs", [])
        for j in hn_data[:5]:
            targets.append({
                "company": j.get("company"),
                "role": j.get("title"),
                "email": j.get("contactEmail")
            })
    elif args.recent:
        disc = load_json(DISCOVERED_ATS_FILE, {}).get("jobs", [])
        if disc:
            for j in disc[:5]:
                targets.append({"company": j.get("company"), "role": j.get("title"), "email": None})
        else:
            apps = load_json(APPLICATIONS_FILE, [])
            for a in apps[-5:]:
                targets.append({"company": a.get("company"), "role": a.get("title"), "email": None})
    else:
        # Default showcase across diverse tech stacks
        targets = [
            {"company": "Simple Analytics", "role": "DevOps Engineer", "email": "jobs@simpleanalytics.com"},
            {"company": "Enterprise Cloud", "role": "Senior .NET Developer", "email": None},
            {"company": "SaaS Platform", "role": "Frontend React Engineer", "email": "careers@saas.io"}
        ]

    print("=" * 75)
    print("✉️  UNIVERSAL SOFT TOUCH COLD OUTREACH & EMAIL DRAFTS")
    print("=" * 75)

    generated = []
    for item in targets:
        res = generate_notes(item["company"], item["role"], args.name, item.get("email"), candidate_name)
        generated.append(res)
        print(f"\n🏢 Company: {res['company']} | 💼 Role: {res['role']}")
        print("-" * 75)

        if res.get("email"):
            print(f"📧 DIRECT EMAIL (Hacker News / Direct Contact: {res['email']}):")
            print(f"   Subject: {res['email_subject']}")
            print("   Body:")
            for line in res['email_body'].split('\n'):
                print(f"     {line}")
            print()

        print("📌 Option A (Engineering Manager / Team Lead on LinkedIn):")
        print(f"   \"{res['em_note']}\"")
        print("\n📌 Option B (Founder / CEO / CTO for Startups):")
        print(f"   \"{res['founder_note']}\"")
        print("\n🔗 1-Click Decision Maker Search:")
        print(f"   • LinkedIn Search: {res['linkedin_url']}")
        print(f"   • X / Twitter:     {res['twitter_url']}")
        print("=" * 75)

    # Save to data/pending_outreach.json for instant reference
    outreach_json_path = os.path.join(BASE_DIR, "data", "pending_outreach.json")
    try:
        with open(outreach_json_path, "w", encoding="utf-8") as f:
            json.dump(generated, f, indent=2)
        print(f"\n[✓] Saved {len(generated)} outreach note(s) to: data/pending_outreach.json")
    except Exception as e:
        print(f"[!] Note save warning: {e}")


if __name__ == "__main__":
    main()
