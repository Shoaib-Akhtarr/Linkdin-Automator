# 🚀 Multi-Platform Job Application Suite (LinkedIn • Wellfound • Remote ATS)

An autonomous, intelligent, anti-detection job application engine built with Playwright, Chrome DevTools Protocol (CDP), and an AI-driven CV synthesizer.

Supports **LinkedIn Easy Apply & External Portals**, **Wellfound (AngelList Startups with AI Pitch Notes)**, and **Curated Remote ATS (Greenhouse, Lever, Ashby)** with on-the-fly ATS CV customization and a 24/7 Autopilot Scheduler.

---

## ✨ Features

- **🌐 Multi-Platform Selector & Autopilot**:
  - **Platform Chooser in Dashboard**: Toggle on-the-fly between **All Platforms (Auto-Rotate)**, **LinkedIn**, **Wellfound**, or **Curated Remote ATS**.
  - **LinkedIn Easy Apply & Universal ATS**: Full modal navigation, screening question evaluation, and resume upload.
  - **Wellfound (AngelList)**: Autonomously applies to tech & AI startups with dynamic personalized pitch notes addressing the founders.
  - **Curated Remote ATS**: Direct ingestion of high-paying remote roles auto-submitted directly to Greenhouse, Lever, and Ashby portals.
  - **Complex Portals (Workday, etc.)**: Pre-fills contact details, attaches tailored CVs, and pauses for 1-click review/login.

- **📄 Dynamic On-the-Fly ATS CV Generator**:
  - Parses each target Job Description (JD) in real time.
  - Extracts required libraries, frameworks, and skills (*LangChain, LangGraph, CrewAI, vLLM, DeepEval, Qdrant, Docker, FastAPI*).
  - Dynamically synthesizes a clean, single-column vector ATS PDF tailored specifically for that company and role title.
  - Uploads the tailored PDF directly to the application.

- **⏱️ 24/7 Autopilot Duty Cycle Scheduler**:
  - Automatically triggers every **2 hours** to apply to a safe batch of **10 jobs**.
  - Mimics natural human duty cycles with randomized delays (3–8s) to protect your account.
  - Live countdown and one-click toggle in the dashboard.

- **🧠 Smart Screening Question Engine**:
  - Evaluates years of experience, work authorizations, CTC/salary numbers, notice periods, and custom questions using your profile.

- **📱 Remote Mobile Access**:
  - Run `start-remote-tunnel.bat` to generate a free, secure public HTTPS URL to monitor and control your dashboard from your phone anywhere in the world.

- **📊 Real-time Control Dashboard**:
  - Local web UI (`http://localhost:3000`) with live browser screenshot previews, terminal event streams, application history, and one-click tailored CV downloads.

---

## 🚀 Quick Start Guide

### 1. Launch Chrome in Remote Debugging Mode
Double-click `launch-chrome.bat` or run:
```bash
chrome.exe --remote-debugging-port=9222 --user-data-dir="%LOCALAPPDATA%\LinkedInAutomationChromeProfile" https://www.linkedin.com/jobs/
```
> *Log in to your LinkedIn account once in this window. Your session is saved permanently.*

### 2. Start the Automation Dashboard
Double-click `start.bat` or run:
```bash
npm start
```
Open **[http://localhost:3000](http://localhost:3000)** in your browser.

### 3. Optional: Mobile Remote Control
Double-click `start-remote-tunnel.bat` to access your dashboard from your smartphone anywhere.

---

## ⚙️ Configuration

- `config/profile.json`: Your personal details, contact info, and skills experience table.
- `config/settings.json`: Search keywords, location, workplace type, autopilot intervals, and blacklist.
- `data/tailored_cvs/`: All dynamically synthesized ATS vector PDFs.
- `data/applications.json`: Application history and tracking ledger.

---

## 🔒 Account Safety

- Recommended daily limit: 25–40 applications/day.
- Uses your local residential IP and existing Chrome cookies to bypass bot detection and CAPTCHAs.
