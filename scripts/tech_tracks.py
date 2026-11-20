#!/usr/bin/env python3
"""
Universal Tech Tracks & Skill Profiles
Provides standardized categorization, skill matching, and tailored outreach
for ANY technology discipline (DevOps, .NET, Web Dev, Backend, Full Stack, Mobile, Data, QA, Security, AI).
"""

import os
import json
import re

TECH_TRACKS = {
    "devops": {
        "name": "DevOps, SRE & Cloud Infrastructure",
        "roles": [
            "devops", "sre", "site reliability", "cloud engineer", "platform engineer",
            "infrastructure", "systems administrator", "sysadmin", "cloud architect",
            "cloud infrastructure", "infra engineer"
        ],
        "skills": [
            "kubernetes", "k8s", "docker", "terraform", "aws", "azure", "gcp",
            "ci/cd", "ansible", "linux", "helm", "grafana", "prometheus",
            "opentofu", "cloudformation", "bash", "jenkins", "argocd"
        ],
        "highlight": "scalable cloud infrastructure, Kubernetes container orchestration, and zero-downtime CI/CD pipelines with Terraform and cloud platforms"
    },
    "dotnet": {
        "name": ".NET, C# & Microsoft Stack",
        "roles": [
            ".net", "dotnet", "c#", "asp.net", "csharp", "wcf", "wpf", "azure developer"
        ],
        "skills": [
            ".net", "c#", "asp.net", "asp.net core", "entity framework", "ef core",
            "azure", "sql server", "microservices", "blazor", "linq", "web api", "csharp"
        ],
        "highlight": "high-throughput enterprise backends using ASP.NET Core, C#, Entity Framework, and resilient microservices architectures on Azure"
    },
    "webdev": {
        "name": "Frontend & Web Development",
        "roles": [
            "frontend", "front-end", "web developer", "react", "vue", "angular",
            "ui engineer", "javascript developer", "typescript developer", "next.js"
        ],
        "skills": [
            "react", "next.js", "typescript", "javascript", "vue", "angular",
            "tailwind", "css", "html", "redux", "graphql", "zustand", "vite", "webpack"
        ],
        "highlight": "modern, responsive web applications using React, Next.js, and TypeScript with clean component architecture and high performance"
    },
    "backend": {
        "name": "Backend & Systems Engineering",
        "roles": [
            "backend", "back-end", "software engineer", "api engineer", "systems engineer",
            "golang engineer", "python engineer", "java engineer", "rust engineer"
        ],
        "skills": [
            "python", "golang", "go ", "rust", "java", "spring boot", "node.js",
            "express", "fastapi", "django", "postgresql", "redis", "kafka", "grpc", "microservices"
        ],
        "highlight": "scalable backend microservices, robust REST/gRPC APIs, and high-concurrency distributed systems with relational and distributed databases"
    },
    "fullstack": {
        "name": "Full Stack Software Engineering",
        "roles": [
            "full stack", "fullstack", "full-stack", "software developer", "application engineer"
        ],
        "skills": [
            "full stack", "fullstack", "react", "node", "typescript", "python",
            "postgresql", "mongodb", "rest api", "graphql", "next.js"
        ],
        "highlight": "end-to-end web applications bridging modern React/TypeScript frontends with reliable, performant backend microservices and databases"
    },
    "mobile": {
        "name": "Mobile Application Development",
        "roles": [
            "mobile engineer", "mobile developer", "ios", "android", "flutter",
            "react native", "swift developer", "kotlin developer"
        ],
        "skills": [
            "ios", "android", "swift", "kotlin", "flutter", "react native", "mobile",
            "xcode", "jetpack compose", "swiftui"
        ],
        "highlight": "cross-platform and native mobile applications with smooth 60fps UI, offline storage, and responsive backend API synchronization"
    },
    "data": {
        "name": "Data Engineering & Analytics",
        "roles": [
            "data engineer", "data analyst", "bi engineer", "analytics engineer",
            "database engineer", "etl developer"
        ],
        "skills": [
            "sql", "python", "snowflake", "dbt", "spark", "databricks", "kafka",
            "etl", "airflow", "bigquery", "postgres", "data pipeline"
        ],
        "highlight": "robust data warehousing, real-time ETL pipelines, and analytical data models using modern data stacks (Snowflake, dbt, Spark)"
    },
    "qa": {
        "name": "QA Automation & SDET",
        "roles": [
            "qa engineer", "sdet", "test engineer", "automation engineer",
            "quality assurance", "test automation"
        ],
        "skills": [
            "playwright", "cypress", "selenium", "pytest", "jest", "automation",
            "e2e", "cucumber", "postman", "testrail"
        ],
        "highlight": "comprehensive automated test frameworks (Playwright, Cypress, Selenium) and robust continuous integration quality gates"
    },
    "security": {
        "name": "Cybersecurity & DevSecOps",
        "roles": [
            "security engineer", "cybersecurity", "infosec", "devsecops",
            "appsec", "soc analyst", "cloud security"
        ],
        "skills": [
            "security", "soc", "penetration testing", "iam", "vulnerability",
            "cryptography", "owasp", "siem", "zero trust", "compliance"
        ],
        "highlight": "enterprise application security, cloud DevSecOps hardening, and proactive threat modeling aligned with OWASP standards"
    },
    "ai": {
        "name": "AI, Machine Learning & LLM Systems",
        "roles": [
            "ai engineer", "machine learning", "ml engineer", "deep learning",
            "llm", "rag", "computer vision", "nlp", "prompt engineer", "ai developer"
        ],
        "skills": [
            "python", "pytorch", "langchain", "langgraph", "crewai", "fastapi",
            "rag", "vector databases", "qdrant", "chromadb", "llm", "machine learning", "nlp"
        ],
        "highlight": "autonomous multi-agent workflows, production RAG pipelines, and LLM orchestration using LangGraph, CrewAI, and PyTorch"
    }
}


def detect_track_from_profile(profile_data):
    """
    Intelligently inspects a profile dictionary (from profile.json)
    and scores the best matching tech track.
    """
    if not profile_data:
        return "all"

    personal = profile_data.get("personal", {})
    headline = (personal.get("headline") or "").lower()
    work_exp = profile_data.get("workExperienceYears", {})
    skills_text = " ".join(work_exp.keys()).lower()
    full_text = f"{headline} {skills_text}"

    scores = {}
    for track_key, track_info in TECH_TRACKS.items():
        score = 0
        # Check roles in headline
        for r in track_info["roles"]:
            if r in headline:
                score += 5
        # Check skills in work experience
        for s in track_info["skills"]:
            if s in full_text:
                score += 2
        scores[track_key] = score

    best_track = max(scores, key=scores.get) if scores else "all"
    if scores.get(best_track, 0) == 0:
        return "all"
    return best_track


def match_job_track(title, description, selected_track="all", remote_only=True):
    """
    Determines if a job posting matches the requested track and remote constraints.
    Returns: (is_match: bool, matched_tracks: list[str])
    """
    text = f"{title} {description}".lower()
    title_lower = title.lower()

    # Remote check if required
    if remote_only:
        is_remote = any(k in text for k in ["remote", "anywhere", "worldwide", "distributed", "virtual", "telecommute"])
        # Check if explicitly onsite only
        if not is_remote and ("onsite only" in text or "on-site only" in text or "no remote" in text):
            return False, []
        if not is_remote:
            # If not explicitly marked remote, check title
            if "remote" not in title_lower:
                return False, []

    matched_tracks = []
    for track_key, track_info in TECH_TRACKS.items():
        role_hit = any(r in title_lower for r in track_info["roles"])
        skill_hit = any(s in text for s in track_info["skills"])
        if role_hit or (skill_hit and any(w in title_lower for w in ["engineer", "developer", "lead", "architect", "analyst"])):
            matched_tracks.append(track_key)

    if selected_track == "all":
        # Any recognized tech track or engineering title
        is_tech = bool(matched_tracks) or any(t in title_lower for t in ["engineer", "developer", "programmer", "architect", "devops", "sre", "admin", "analyst"])
        return is_tech, matched_tracks

    if selected_track in TECH_TRACKS:
        return (selected_track in matched_tracks), matched_tracks

    return False, []


def get_track_highlight(title, track_hint=None):
    """
    Returns an impactful highlight description for cold outreach matching the role.
    """
    t = title.lower()
    if track_hint and track_hint in TECH_TRACKS:
        return TECH_TRACKS[track_hint]["highlight"]

    for track_key, track_info in TECH_TRACKS.items():
        if any(r in t for r in track_info["roles"]):
            return track_info["highlight"]

    return "scalable modern software systems, clean microservices, and reliable cloud deployments"
