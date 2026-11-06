// Home Care Command Center: home health Conditions of Participation (42 CFR Part 484) readiness.
// Checklists are FUTURE4000's own plain-language planning questions written from the regulation,
// not official survey determinations. Verify against eCFR and CMS State Operations Manual Appendix B.
import express from 'express';
import { q } from './db.js';
import { requireUser, requireRole, audit } from './auth.js';
import { scrubPHI } from './phi.js';

export const HC_SCHEMA = `
CREATE TABLE IF NOT EXISTS hc_assessments (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  cop TEXT NOT NULL,
  answers JSONB NOT NULL,
  completed_by BIGINT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_hc_assessments_org ON hc_assessments(org_id, cop, created_at DESC);
CREATE TABLE IF NOT EXISTS hc_deficiencies (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  cop TEXT NOT NULL,
  question_id TEXT,
  description TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'standard' CHECK (severity IN ('standard','condition','immediate_jeopardy')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','ready_to_verify','closed')),
  responsible TEXT,
  action_plan TEXT,
  due_date DATE,
  evidence TEXT,
  ij_leadership_notified BOOLEAN NOT NULL DEFAULT FALSE,
  ij_patients_protected BOOLEAN NOT NULL DEFAULT FALSE,
  ij_evidence_preserved BOOLEAN NOT NULL DEFAULT FALSE,
  responsible_user BIGINT REFERENCES users(id),
  verified_by BIGINT REFERENCES users(id),
  created_by BIGINT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_hc_deficiencies_org ON hc_deficiencies(org_id, status);
`;

// 15 Conditions of Participation in 42 CFR Part 484 (Subparts B and C). Questions are planning prompts.
const C = (id, section, title, summary, questions) => ({ id, section, title, summary, questions: questions.map((text, i) => ({ id: `${id}-${i + 1}`, text })) });
export const HH_COPS = [
  C('oasis-release', '484.40', 'Release of patient-identifiable OASIS information', 'OASIS data that identifies a patient stays confidential and is never released to the public.', [
    'Patient-identifiable OASIS data is released only as the regulation permits, never to the public.',
    'Staff with OASIS access are limited to those who need it, and access is reviewed.',
    'OASIS files and exports are stored and transmitted securely.']),
  C('oasis-reporting', '484.45', 'Reporting OASIS information', 'Every OASIS assessment collected is encoded and submitted electronically to CMS.', [
    'All required OASIS assessments are submitted electronically within 30 days of completion.',
    'Submission confirmation and error reports are reviewed and errors corrected.',
    'The agency keeps current with the OASIS version and submission specifications in use.']),
  C('patient-rights', '484.50', 'Patient rights', 'Patients are informed of and can exercise their rights, including complaints without retaliation.', [
    'Each patient receives written notice of rights at the initial evaluation, in a language and format they understand.',
    'Patients receive the OASIS privacy notice and the agency contact and state hotline information.',
    'Complaints are documented, investigated and resolved, and patients are protected from retaliation.',
    'Patients are told in advance of changes to the plan of care, visit frequency or charges they owe.']),
  C('comprehensive-assessment', '484.55', 'Comprehensive assessment of patients', 'Each patient receives a timely initial and comprehensive assessment, updated as required.', [
    'The initial assessment visit happens within 48 hours of referral or return home, or on the ordered start-of-care date.',
    'The comprehensive assessment, including OASIS, is completed within 5 calendar days after start of care.',
    'Drug regimen review is part of each comprehensive assessment and identified issues are followed up.',
    'Assessments are updated at the required time points and after significant changes or hospital discharge.']),
  C('discharge-planning', '484.58', 'Discharge planning', 'Discharge and transfer planning is patient-centered and information follows the patient.', [
    'Discharge planning considers the patient\'s goals, caregiver support and post-discharge needs.',
    'Patients choosing post-acute providers receive information to support their choice.',
    'Required information is sent to the receiving provider or practitioner when patients transfer or discharge.']),
  C('care-planning', '484.60', 'Care planning, coordination of services, and quality of care', 'Care follows an individualized written plan established and reviewed with the ordering practitioner.', [
    'Every patient has an individualized written plan of care with goals, services, frequency and orders.',
    'Verbal orders are documented, signed and authenticated as required.',
    'The plan of care is reviewed and revised at least as often as required and when the condition changes.',
    'Care is coordinated among all disciplines, and the ordering practitioner is promptly told of changes.']),
  C('qapi', '484.65', 'Quality assessment and performance improvement (QAPI)', 'A data-driven, agency-wide QAPI program tracks outcomes and runs improvement projects.', [
    'The QAPI program measures quality indicators, including OASIS-based outcomes, and adverse events.',
    'Performance improvement projects are run and documented, with priorities on high-risk, high-volume or problem-prone areas.',
    'The governing body is accountable for QAPI and receives regular reports.']),
  C('infection-control', '484.70', 'Infection prevention and control', 'An infection prevention program protects patients and staff in the home.', [
    'Staff follow standard precautions and agency infection control policies in every home.',
    'Infections are tracked and analyzed as part of QAPI.',
    'Staff, patients and caregivers receive infection prevention education.']),
  C('skilled-services', '484.75', 'Skilled professional services', 'Skilled services are delivered by qualified professionals within their scope and the plan of care.', [
    'Skilled nursing and therapy are provided by qualified, licensed professionals according to the plan of care.',
    'Professionals teach patients and caregivers and document their understanding.',
    'Professionals take part in QAPI and in coordinating care.']),
  C('aide-services', '484.80', 'Home health aide services', 'Aides are trained, competent and supervised, and follow a written aide care plan.', [
    'Each aide completed qualifying training (at least 75 hours, including at least 16 hours of supervised practical training) and a competency evaluation, or meets state certification rules.',
    'Aides have a written care plan from a registered nurse or therapist listing permitted tasks.',
    'Supervisory visits happen on time: at least every 14 days when skilled services are also provided.',
    'Aides receive the required annual in-service training.']),
  C('laws', '484.100', 'Compliance with federal, state and local laws', 'The agency complies with health and safety laws, licensure, and ownership disclosure.', [
    'The agency is licensed as required by the state and follows applicable laws.',
    'Ownership and control information is disclosed and kept current.',
    'Laboratory services are provided only under the applicable certification.']),
  C('emergency-preparedness', '484.102', 'Emergency preparedness', 'An all-hazards emergency plan, policies, communication plan, and training and testing program.', [
    'A risk-based emergency plan addresses patient population, continuity of operations and individual patient plans.',
    'A communication plan includes contact information for staff, practitioners and emergency officials.',
    'Staff are trained and the plan is tested with exercises at the required frequency, and lessons are documented.']),
  C('administration', '484.105', 'Organization and administration of services', 'Clear governance, a qualified administrator and clinical manager, and oversight of branches.', [
    'A governing body assumes full legal authority and responsibility for operations.',
    'A qualified administrator and clinical manager are designated, with alternates.',
    'The parent agency supervises every branch and contracted service, with written agreements.']),
  C('clinical-records', '484.110', 'Clinical records', 'Accurate, complete, protected clinical records that are retained and retrievable.', [
    'Each record includes assessments, plan of care, orders, visit notes and discharge or transfer summaries.',
    'Discharge summaries go to the practitioner within 5 business days; transfer summaries within 2 business days.',
    'Records are retained at least 5 years after discharge, or longer if state law requires.',
    'Patients receive a copy of their record on request within the required timeframe.']),
  C('personnel', '484.115', 'Personnel qualifications', 'Every role meets the qualifications the regulation sets, with licenses verified.', [
    'Licenses and certifications are verified at hire and before expiration for every clinician.',
    'The administrator and clinical manager meet the regulation\'s qualifications.',
    'Personnel files show qualifications for every discipline the agency provides.']),
];
const copById = (id) => HH_COPS.find((c) => c.id === id);

export const hcRouter = express.Router();
const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => {
  if (!e.status) console.error(e);
  res.status(e.status || 500).json({ error: e.status ? e.message : 'Something went wrong. Please try again.' });
});
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const ASSESSORS = ['admin', 'compliance_officer', 'clinician_reviewer'];
const noPHI = (t, field) => { if (t && scrubPHI(String(t)).redactions > 0) throw bad(`${field} looks like it contains patient information. Use roles, dates and record counts, never names or record numbers.`); };

hcRouter.get('/cops', requireUser, wrap(async (req, res) => {
  const { rows } = await q(`SELECT DISTINCT ON (cop) cop, answers, created_at FROM hc_assessments WHERE org_id=$1 ORDER BY cop, created_at DESC`, [req.user.org_id]);
  const open = await q(`SELECT cop, count(*)::int AS n, bool_or(severity='immediate_jeopardy') AS ij FROM hc_deficiencies WHERE org_id=$1 AND status <> 'closed' GROUP BY cop`, [req.user.org_id]);
  const latest = Object.fromEntries(rows.map((r) => [r.cop, r]));
  const defs = Object.fromEntries(open.rows.map((r) => [r.cop, r]));
  const cops = HH_COPS.map((c) => {
    const a = latest[c.id]?.answers || {};
    const yes = Object.values(a).filter((v) => v === 'yes').length, no = Object.values(a).filter((v) => v === 'no').length;
    return { ...c, readiness: yes + no ? Math.round((100 * yes) / (yes + no)) : null, lastAssessed: latest[c.id]?.created_at || null,
      lastAnswers: a, openDeficiencies: defs[c.id]?.n || 0, immediateJeopardy: Boolean(defs[c.id]?.ij) };
  });
  const scored = cops.filter((c) => c.readiness !== null);
  res.json({ cops, overallReadiness: scored.length ? Math.round(scored.reduce((s, c) => s + c.readiness, 0) / scored.length) : null,
    assessed: scored.length, total: cops.length,
    notice: 'Readiness tool written from 42 CFR Part 484. Not an official survey determination. Verify requirements in the current eCFR and CMS State Operations Manual Appendix B.' });
}));

hcRouter.post('/assessments', requireRole(...ASSESSORS), wrap(async (req, res) => {
  const cop = copById(req.body?.cop);
  if (!cop) throw bad('Choose a condition to assess.');
  const answers = {}, notes = req.body?.notes || {};
  for (const qn of cop.questions) {
    const v = req.body?.answers?.[qn.id];
    if (!['yes', 'no', 'na'].includes(v)) throw bad('Answer every question with Yes, No or N/A.');
    answers[qn.id] = v;
    noPHI(notes[qn.id], 'A note');
  }
  const a = await q('INSERT INTO hc_assessments (org_id, cop, answers, completed_by) VALUES ($1,$2,$3,$4) RETURNING id', [req.user.org_id, cop.id, answers, req.user.id]);
  let created = 0;
  for (const qn of cop.questions.filter((x) => answers[x.id] === 'no')) {
    const exists = await q(`SELECT 1 FROM hc_deficiencies WHERE org_id=$1 AND question_id=$2 AND status <> 'closed'`, [req.user.org_id, qn.id]);
    if (exists.rowCount) continue;
    const note = String(notes[qn.id] || '').trim().slice(0, 500);
    await q(`INSERT INTO hc_deficiencies (org_id, cop, question_id, description, created_by) VALUES ($1,$2,$3,$4,$5)`,
      [req.user.org_id, cop.id, qn.id, `§${cop.section}: ${qn.text}${note ? ` Finding: ${note}` : ''}`, req.user.id]);
    created += 1;
  }
  await audit(req, 'homecare.assessment.completed', 'hc_assessment', a.rows[0].id, { cop: cop.id, deficiencies_created: created });
  res.status(201).json({ ok: true, deficienciesCreated: created });
}));

const pubDef = (d) => ({ id: d.id, cop: d.cop, section: copById(d.cop)?.section, description: d.description, severity: d.severity, status: d.status,
  responsible: d.responsible, actionPlan: d.action_plan, dueDate: d.due_date, evidence: d.evidence,
  ij: { leadershipNotified: d.ij_leadership_notified, patientsProtected: d.ij_patients_protected, evidencePreserved: d.ij_evidence_preserved },
  overdue: Boolean(d.due_date && d.status !== 'closed' && new Date(d.due_date) < new Date(new Date().toDateString())), createdAt: d.created_at, closedAt: d.closed_at });

hcRouter.get('/deficiencies', requireUser, wrap(async (req, res) => {
  const { rows } = await q(`SELECT * FROM hc_deficiencies WHERE org_id=$1 ORDER BY (status='closed'), (severity='immediate_jeopardy') DESC, created_at DESC`, [req.user.org_id]);
  res.json(rows.map(pubDef));
}));

const NEXT = { open: ['in_progress'], in_progress: ['ready_to_verify', 'open'], ready_to_verify: ['closed', 'in_progress'], closed: [] };
hcRouter.patch('/deficiencies/:id', requireRole(...ASSESSORS), wrap(async (req, res) => {
  const { rows } = await q('SELECT * FROM hc_deficiencies WHERE id=$1 AND org_id=$2', [req.params.id, req.user.org_id]);
  const d = rows[0];
  if (!d) throw bad('Deficiency not found.', 404);
  const b = req.body || {};
  for (const [k, label] of [['responsible', 'Responsible person'], ['actionPlan', 'The action plan'], ['evidence', 'Evidence']]) noPHI(b[k], label);
  const u = {
    severity: b.severity ?? d.severity, responsible: b.responsible ?? d.responsible, action_plan: b.actionPlan ?? d.action_plan,
    due_date: b.dueDate ?? d.due_date, evidence: b.evidence ?? d.evidence,
    ij_leadership_notified: b.ij?.leadershipNotified ?? d.ij_leadership_notified, ij_patients_protected: b.ij?.patientsProtected ?? d.ij_patients_protected,
    ij_evidence_preserved: b.ij?.evidencePreserved ?? d.ij_evidence_preserved, status: d.status, responsible_user: d.responsible_user, verified_by: d.verified_by,
  };
  if (!['standard', 'condition', 'immediate_jeopardy'].includes(u.severity)) throw bad('Unknown severity.');
  if (b.status && b.status !== d.status) {
    if (!NEXT[d.status].includes(b.status)) throw bad(`A deficiency cannot move from ${d.status.replace(/_/g, ' ')} to ${b.status.replace(/_/g, ' ')}.`);
    if (u.severity === 'immediate_jeopardy' && d.status === 'open' && !(u.ij_leadership_notified && u.ij_patients_protected && u.ij_evidence_preserved)) {
      throw bad('Possible immediate jeopardy: record that leadership was notified, patients were protected and evidence was preserved before moving on.');
    }
    if (b.status === 'in_progress' && d.status === 'open') { if (!u.action_plan || !u.responsible) throw bad('Add an action plan and a responsible person first.'); u.responsible_user = req.user.id; }
    if (b.status === 'ready_to_verify' && !u.evidence) throw bad('Add evidence that the fix works before asking for verification.');
    if (b.status === 'closed') {
      if (d.responsible_user && String(d.responsible_user) === String(req.user.id)) throw bad('The person who carried out the fix cannot verify it. Ask another reviewer.', 403);
      u.verified_by = req.user.id;
    }
    u.status = b.status;
  }
  const r = await q(`UPDATE hc_deficiencies SET severity=$2, responsible=$3, action_plan=$4, due_date=$5, evidence=$6, ij_leadership_notified=$7,
      ij_patients_protected=$8, ij_evidence_preserved=$9, status=$10, responsible_user=$11, verified_by=$12, updated_at=now(),
      closed_at = CASE WHEN $10='closed' THEN now() ELSE NULL END WHERE id=$1 RETURNING *`,
    [d.id, u.severity, u.responsible, u.action_plan, u.due_date || null, u.evidence, u.ij_leadership_notified, u.ij_patients_protected, u.ij_evidence_preserved,
      u.status, u.responsible_user, u.verified_by]);
  await audit(req, 'homecare.deficiency.updated', 'hc_deficiency', d.id, { from: d.status, to: u.status, severity: u.severity });
  res.json(pubDef(r.rows[0]));
}));

hcRouter.get('/plan-of-correction.csv', requireRole(...ASSESSORS), wrap(async (req, res) => {
  const { rows } = await q(`SELECT * FROM hc_deficiencies WHERE org_id=$1 ORDER BY cop, created_at`, [req.user.org_id]);
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [['Section', 'Deficiency', 'Severity', 'Status', 'Responsible', 'Action plan', 'Due date', 'Evidence of correction', 'Closed'].map(cell).join(',')];
  for (const d of rows) lines.push([`§${copById(d.cop)?.section}`, d.description, d.severity.replace(/_/g, ' '), d.status.replace(/_/g, ' '), d.responsible, d.action_plan,
    d.due_date ? new Date(d.due_date).toISOString().slice(0, 10) : '', d.evidence, d.closed_at ? new Date(d.closed_at).toISOString().slice(0, 10) : ''].map(cell).join(','));
  await audit(req, 'homecare.poc.exported', 'hc_deficiency', null, { rows: rows.length });
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="home-health-plan-of-correction.csv"');
  res.send(lines.join('\n'));
}));
