// LearnTrack: training courses built from approved policies, quizzes, scoring, certificates, completion tracking.
import crypto from 'node:crypto';
import express from 'express';
import { q } from './db.js';
import { requireUser, requireRole, audit } from './auth.js';
import { complete, aiConfigured } from './ai.js';

export const LEARN_SCHEMA = `
CREATE TABLE IF NOT EXISTS courses (
  id             BIGSERIAL PRIMARY KEY,
  org_id         BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  policy_id      BIGINT REFERENCES policies(id) ON DELETE SET NULL,
  policy_version INTEGER,
  title          TEXT NOT NULL,
  content        JSONB NOT NULL,
  pass_score     INTEGER NOT NULL DEFAULT 80,
  due_days       INTEGER NOT NULL DEFAULT 30,
  source         TEXT NOT NULL DEFAULT 'ai',
  created_by     BIGINT REFERENCES users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS course_attempts (
  id          BIGSERIAL PRIMARY KEY,
  course_id   BIGINT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  score       INTEGER NOT NULL,
  passed      BOOLEAN NOT NULL,
  answers     JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS certificates (
  id          TEXT PRIMARY KEY,
  course_id   BIGINT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  score       INTEGER NOT NULL,
  issued_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (course_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_courses_org ON courses(org_id);
CREATE INDEX IF NOT EXISTS idx_attempts_user ON course_attempts(user_id, course_id);
`;

const COURSE_PROMPT = `You build staff training for FUTURE4000 LearnTrack from an approved healthcare policy.
Return ONLY valid JSON, no other text, in exactly this shape:
{"objectives":["..."],"key_points":["..."],"scenario":{"situation":"...","correct_action":"..."},
 "questions":[{"question":"...","options":["...","...","...","..."],"answer":0,"rationale":"..."}]}
Rules: 3-5 objectives; 5-8 key points in plain language; one realistic clinical scenario; exactly 10 multiple-choice questions,
each with 4 options, "answer" is the 0-based index of the single correct option, and a one-sentence rationale.
Questions must test what the policy actually says. Never include patient-identifying information.`;

function parseCourse(text) {
  const start = text.indexOf('{'), end = text.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('AI did not return a course.');
  const c = JSON.parse(text.slice(start, end + 1));
  const okQ = Array.isArray(c.questions) && c.questions.length >= 5 && c.questions.every((x) =>
    x.question && Array.isArray(x.options) && x.options.length >= 2 && Number.isInteger(x.answer) && x.answer >= 0 && x.answer < x.options.length);
  if (!okQ || !Array.isArray(c.key_points)) throw new Error('AI course was incomplete. Try again.');
  return c;
}

// Without AI: a reading-and-attestation course (no quiz) so training can still be assigned.
function attestationCourse(body) {
  const headings = body.split('\n').map((l) => l.trim()).filter((l) => /^\d+(\.\d+)?\.?\s+[A-Z]/.test(l)).slice(0, 8);
  return { objectives: ['Read and understand the approved policy.', 'Know where to find it and who to ask with questions.'],
    key_points: headings.length ? headings : ['Read the full policy text below.'], scenario: null, questions: [], reading: body };
}

export const learnRouter = express.Router();
const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => {
  if (!e.status) console.error(e);
  res.status(e.status || 500).json({ error: e.status ? e.message : 'Something went wrong. The error has been logged.' });
});
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });

learnRouter.post('/courses', requireRole('admin', 'compliance_officer'), wrap(async (req, res) => {
  const p = (await q(`SELECT * FROM policies WHERE id=$1 AND org_id=$2 AND status='approved'`, [req.body?.policy_id, req.user.org_id])).rows[0];
  if (!p) throw bad('Choose an approved policy.', 404);
  const body = (await q('SELECT body FROM policy_versions WHERE policy_id=$1 AND version=$2', [p.id, p.current_version])).rows[0].body;
  let content, source = 'ai', model = null;
  if (aiConfigured()) {
    const r = await complete('standard', COURSE_PROMPT, `Policy title: ${p.title}\n\n${body}`);
    content = { ...parseCourse(r.text), reading: body };
    model = r.model;
  } else {
    content = attestationCourse(body);
    source = 'attestation';
  }
  const c = (await q(
    `INSERT INTO courses (org_id, policy_id, policy_version, title, content, source, created_by, due_days) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [req.user.org_id, p.id, p.current_version, `${p.title} Training`, content, source, req.user.id, +req.body?.due_days || 30])).rows[0];
  await audit(req, 'learn.course_created', 'course', c.id, { policy_id: p.id, version: p.current_version, source, model });
  res.status(201).json({ id: c.id, source, questions: content.questions.length });
}));

learnRouter.get('/courses', requireUser, wrap(async (req, res) => {
  const { rows } = await q(
    `SELECT c.id, c.title, c.policy_id, c.policy_version, c.pass_score, c.source, c.created_at,
            (c.created_at + (c.due_days || ' days')::interval)::date AS due_date,
            jsonb_array_length(c.content->'questions') AS question_count,
            cert.id AS certificate_id, cert.score AS cert_score,
            (SELECT max(score) FROM course_attempts a WHERE a.course_id=c.id AND a.user_id=$2) AS best_score,
            (SELECT count(*) FROM certificates x WHERE x.course_id=c.id)::int AS completions,
            (SELECT count(*) FROM users u WHERE u.org_id=c.org_id AND u.active)::int AS staff
       FROM courses c LEFT JOIN certificates cert ON cert.course_id=c.id AND cert.user_id=$2
      WHERE c.org_id=$1 ORDER BY c.created_at DESC`, [req.user.org_id, req.user.id]);
  res.json(rows);
}));

learnRouter.get('/courses/:id', requireUser, wrap(async (req, res) => {
  const c = (await q('SELECT * FROM courses WHERE id=$1 AND org_id=$2', [req.params.id, req.user.org_id])).rows[0];
  if (!c) throw bad('Course not found.', 404);
  // Answers and rationales are never sent to the learner before they submit.
  const questions = c.content.questions.map(({ question, options }) => ({ question, options }));
  res.json({ id: c.id, title: c.title, pass_score: c.pass_score, objectives: c.content.objectives, key_points: c.content.key_points,
    scenario: c.content.scenario ? { situation: c.content.scenario.situation } : null, reading: c.content.reading, questions });
}));

learnRouter.post('/courses/:id/attempt', requireUser, wrap(async (req, res) => {
  const c = (await q('SELECT * FROM courses WHERE id=$1 AND org_id=$2', [req.params.id, req.user.org_id])).rows[0];
  if (!c) throw bad('Course not found.', 404);
  const qs = c.content.questions;
  const answers = Array.isArray(req.body?.answers) ? req.body.answers.map((a) => (Number.isInteger(a) ? a : -1)) : [];
  let score = 100, feedback = [];
  if (qs.length) {
    if (answers.length !== qs.length) throw bad(`Answer all ${qs.length} questions.`);
    const correct = qs.filter((x, i) => answers[i] === x.answer).length;
    score = Math.round((correct / qs.length) * 100);
    feedback = qs.map((x, i) => ({ correct: answers[i] === x.answer, answer: x.answer, rationale: x.rationale }));
  } else if (req.body?.attest !== true) {
    throw bad('Confirm that you read and understand the policy.');
  }
  const passed = score >= c.pass_score;
  await q('INSERT INTO course_attempts (course_id, user_id, score, passed, answers) VALUES ($1,$2,$3,$4,$5)', [c.id, req.user.id, score, passed, JSON.stringify(answers)]);
  let certificate = null;
  if (passed) {
    certificate = `F4-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
    const ins = await q('INSERT INTO certificates (id, course_id, user_id, score) VALUES ($1,$2,$3,$4) ON CONFLICT (course_id, user_id) DO NOTHING RETURNING id',
      [certificate, c.id, req.user.id, score]);
    if (!ins.rowCount) certificate = (await q('SELECT id FROM certificates WHERE course_id=$1 AND user_id=$2', [c.id, req.user.id])).rows[0].id;
    if (c.policy_id) await q('INSERT INTO acknowledgments (policy_id, version, user_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [c.policy_id, c.policy_version, req.user.id]);
  }
  await audit(req, passed ? 'learn.passed' : 'learn.failed', 'course', c.id, { score });
  res.json({ score, passed, pass_score: c.pass_score, certificate, feedback });
}));

learnRouter.get('/report', requireRole('admin', 'compliance_officer'), wrap(async (req, res) => {
  const { rows } = await q(
    `SELECT u.full_name, u.role, c.title, cert.id AS certificate, cert.score, cert.issued_at,
            (c.created_at + (c.due_days || ' days')::interval)::date AS due_date
       FROM users u CROSS JOIN courses c
       LEFT JOIN certificates cert ON cert.course_id=c.id AND cert.user_id=u.id
      WHERE u.org_id=$1 AND c.org_id=$1 AND u.active ORDER BY c.title, u.full_name`, [req.user.org_id]);
  res.json(rows);
}));

// Printable certificate (open in a new tab and print or save as PDF).
learnRouter.get('/certificates/:id', requireUser, wrap(async (req, res) => {
  const r = (await q(
    `SELECT cert.*, u.full_name, u.credentials, c.title, o.name AS org FROM certificates cert
       JOIN users u ON u.id=cert.user_id JOIN courses c ON c.id=cert.course_id JOIN organizations o ON o.id=c.org_id
      WHERE cert.id=$1 AND o.id=$2`, [req.params.id, req.user.org_id])).rows[0];
  if (!r) throw bad('Certificate not found.', 404);
  const e = (s) => String(s ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  res.type('html').send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Certificate ${e(r.id)}</title>
<style>body{font-family:Georgia,serif;background:#f4f1ea;margin:0;padding:40px}.c{max-width:900px;margin:auto;background:#fff;border:12px double #0b2545;padding:60px;text-align:center}
h1{color:#0b2545;font-size:40px;margin:0 0 8px;letter-spacing:2px}h2{font-weight:normal;font-size:28px;margin:30px 0 6px}.t{color:#13a89e;font-size:22px;font-weight:bold}
.m{color:#555;margin-top:40px;font-size:14px}@media print{body{background:#fff;padding:0}}</style></head><body><div class="c">
<div style="color:#13a89e;letter-spacing:4px">FUTURE4000 LEARNTRACK</div><h1>Certificate of Completion</h1><p>This certifies that</p>
<h2>${e(r.full_name)}${r.credentials ? `, ${e(r.credentials)}` : ''}</h2><p>successfully completed</p><p class="t">${e(r.title)}</p>
<p>with a score of ${r.score}% at ${e(r.org)}</p><p class="m">Issued ${new Date(r.issued_at).toLocaleDateString('en-US', { dateStyle: 'long' })} · Certificate ID ${e(r.id)}</p>
</div><script>window.onload=()=>setTimeout(()=>window.print(),300)</script></body></html>`);
}));
