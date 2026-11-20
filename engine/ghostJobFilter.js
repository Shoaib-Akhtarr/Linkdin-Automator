/**
 * Ghost Job Filter — Pre-apply stale listing detector
 *
 * Checks before applying whether a job is a "ghost" (quota full, frozen, stale).
 * Sources checked (in order, fastest first):
 *   1. Local tracker — already marked GHOST_QUOTA_FULL or GHOST_STALE
 *   2. Date check — posted > 30 days ago
 *   3. Description text patterns — "position has been filled", "no longer accepting"
 *   4. Groq AI — NLP analysis via native fetch when pattern confidence is low
 *
 * Returns: { isGhost: boolean, reason: string, confidence: number, source: string }
 */

'use strict';

const path = require('path');
const tracker = require('./tracker');
require('./envLoader');

// ─── Config ──────────────────────────────────────────────────────────────────
const STALE_DAYS_THRESHOLD = 30;
const GROQ_MODEL = 'qwen/qwen3.8-27b';
const GROQ_TIMEOUT_MS = 8000;

// ─── Pattern Signals ─────────────────────────────────────────────────────────

const HARD_GHOST_PATTERNS = [
  /position has been filled/i,
  /no longer accepting (applications|candidates)/i,
  /this (position|role|job) (is|has been) (closed|filled|cancelled)/i,
  /hiring (is |has been )?(frozen|paused|on hold|suspended)/i,
  /not (currently )?hiring/i,
  /quota.{0,20}full/i,
  /repost(ed|ing).{0,30}(same|identical|duplicate)/i,
  /we.{0,20}(paused|stopped|suspended).{0,20}hiring/i,
];

const SOFT_GHOST_PATTERNS = [
  /posted.{0,10}(\d+).{0,10}(months?|weeks?)\s+ago/i,
  /repost(ed)?/i,
  /urgently hiring/i,
  /immediate(ly)? (available|joining|start)/i,
  /applications? (may )?close/i,
  /this listing.{0,30}expired/i,
];

function daysSince(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  return (Date.now() - d.getTime()) / (1000 * 60 * 60 * 24);
}

function countSoftMatches(text) {
  return SOFT_GHOST_PATTERNS.filter(p => p.test(text)).length;
}

class GhostJobFilter {
  /**
   * Full ghost evaluation for a job before applying.
   */
  async evaluate(job) {
    // 1. Tracker check
    const prior = tracker.findPriorApplication(job);
    if (prior && prior.status === 'GHOST_QUOTA_FULL') {
      return {
        isGhost: true,
        reason: `Previously confirmed ghost: ${prior.notes || 'quota full / position closed'}`,
        confidence: 1.0,
        source: 'tracker'
      };
    }
    if (prior && prior.status === 'GHOST_STALE') {
      return {
        isGhost: true,
        reason: 'Previously confirmed stale listing',
        confidence: 1.0,
        source: 'tracker'
      };
    }

    const companyGhosts = (tracker.data?.applications || []).filter(a =>
      (a.status === 'GHOST_QUOTA_FULL' || a.status === 'GHOST_STALE') &&
      tracker.cleanText(a.company) === tracker.cleanText(job.company)
    );
    if (companyGhosts.length >= 2) {
      return {
        isGhost: true,
        reason: `Company "${job.company}" has ${companyGhosts.length} ghost-confirmed roles — hiring is frozen`,
        confidence: 0.92,
        source: 'tracker_company_pattern'
      };
    }

    const desc = (job.description || '').slice(0, 4000);
    const title = job.title || '';
    const fullText = `${title} ${desc}`;

    // 2. Hard pattern match
    for (const p of HARD_GHOST_PATTERNS) {
      if (p.test(fullText)) {
        this._markGhost(job, `Hard pattern: ${p.toString().slice(1, 60)}`);
        return {
          isGhost: true,
          reason: `Description contains ghost signal: "${p.toString().slice(1, 60)}"`,
          confidence: 0.95,
          source: 'pattern_hard'
        };
      }
    }

    // 3. Date staleness check
    const postAge = daysSince(job.postedAt || job.detectedAt);
    if (postAge !== null && postAge > STALE_DAYS_THRESHOLD) {
      const softCount = countSoftMatches(fullText);
      if (postAge > 60 || softCount >= 2) {
        const reason = postAge > 60
          ? `Job posted ${Math.round(postAge)} days ago (>${STALE_DAYS_THRESHOLD}d threshold)`
          : `Job posted ${Math.round(postAge)} days ago + ${softCount} soft ghost signals`;
        this._markGhost(job, reason, 'GHOST_STALE');
        return { isGhost: true, reason, confidence: 0.85, source: 'date_check' };
      }
      if (postAge > STALE_DAYS_THRESHOLD) {
        return this._askGroq(job, `Job is ${Math.round(postAge)} days old — checking if active`);
      }
    }

    // 4. Soft patterns
    const softCount = countSoftMatches(fullText);
    if (softCount >= 3) {
      return this._askGroq(job, `${softCount} soft ghost signals detected`);
    }

    return { isGhost: false, reason: 'No ghost signals detected', confidence: 0.9, source: 'pattern_clear' };
  }

  async _askGroq(job, triggerReason) {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      return { isGhost: false, reason: 'Groq unavailable — allowing by default', confidence: 0.5, source: 'groq_unavailable' };
    }

    const prompt = `You are a job listing analyzer. Determine if the following job is a "ghost job" — meaning it is no longer accepting applications, the position is already filled, hiring is frozen, or this is a stale repost.

Company: ${job.company || 'Unknown'}
Title: ${job.title || 'Unknown'}
Posted: ${job.postedAt || job.detectedAt || 'Unknown date'}
Description:
${(job.description || '').slice(0, 1500)}

Trigger reason: ${triggerReason}

Respond with ONLY valid JSON:
{ "isGhost": true|false, "confidence": 0.0-1.0, "reason": "one sentence explanation" }`;

    try {
      let data;
      try {
        const cloudGateway = require('./cloudAiGateway');
        data = await cloudGateway.callChatCompletions({
          model: GROQ_MODEL,
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 150,
          temperature: 0.1
        }, { requestType: 'question_qa', timeoutMs: GROQ_TIMEOUT_MS });
      } catch (gwErr) {
        if (gwErr.message && gwErr.message.includes('Insufficient AI credits')) {
          throw gwErr;
        }
        if (apiKey) {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), GROQ_TIMEOUT_MS);
          const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
              model: GROQ_MODEL,
              messages: [{ role: 'user', content: prompt }],
              max_tokens: 150,
              temperature: 0.1
            }),
            signal: controller.signal
          });
          clearTimeout(timer);
          if (res.ok) data = await res.json();
        }
      }

      if (!data) {
        return { isGhost: false, reason: 'AI Gateway unavailable', confidence: 0.3, source: 'groq_error' };
      }
      const raw = data.choices?.[0]?.message?.content?.trim() || '{}';
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      const result = jsonMatch ? JSON.parse(jsonMatch[0]) : {};

      const isGhost = result.isGhost === true && (result.confidence || 0) >= 0.7;
      if (isGhost) {
        this._markGhost(job, `Groq: ${result.reason || 'confirmed ghost'}`, 'GHOST_STALE');
      }

      return {
        isGhost,
        reason: result.reason || 'Groq analysis complete',
        confidence: result.confidence || 0.5,
        source: 'groq'
      };
    } catch (err) {
      return { isGhost: false, reason: `Groq error: ${err.message}`, confidence: 0.3, source: 'groq_error' };
    }
  }

  _markGhost(job, reason, statusCode = 'GHOST_QUOTA_FULL') {
    try {
      tracker.recordOutcome(
        { jobId: job.jobId || `ghost_${Date.now()}`, company: job.company, title: job.title, platform: job.platform || 'unknown' },
        statusCode,
        { notes: reason, stage: 'pre_apply_filter' }
      );
    } catch (_) {}
  }

  quickCheck(job) {
    const prior = tracker.findPriorApplication(job);
    if (prior?.status === 'GHOST_QUOTA_FULL' || prior?.status === 'GHOST_STALE') return true;
    const fullText = `${job.title || ''} ${(job.description || '').slice(0, 500)}`;
    return HARD_GHOST_PATTERNS.some(p => p.test(fullText));
  }
}

module.exports = new GhostJobFilter();
