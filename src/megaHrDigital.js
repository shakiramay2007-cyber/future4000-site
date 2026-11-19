// MEGAHOSPITAL HR4000 controlled digital records and orientation literature.
// No PHI, SSNs, bank/card information, occupational medical details or background findings.
import express from 'express';
import {q} from './db.js';
import {requireUser,requireRole,audit} from './auth.js';
import {MEGA_HR,getMegaHrForm} from './megaHr4000.js';

export const MEGA_HR_DIGITAL_SCHEMA = `
CREATE TABLE IF NOT EXISTS mega_hr_digital_forms (
 id BIGSERIAL PRIMARY KEY,
 org_id BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 role_id TEXT NOT NULL, form_id TEXT NOT NULL,
 subject_reference TEXT NOT NULL,
 template_version TEXT NOT NULL DEFAULT '2026-11-DRAFT',
 answers JSONB NOT NULL DEFAULT '{}'::jsonb,
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','submitted','approved','returned')),
 created_by BIGINT NOT NULL REFERENCES users(id),
 updated_by BIGINT NOT NULL REFERENCES users(id),
 reviewed_by BIGINT REFERENCES users(id),
 review_note TEXT NOT NULL DEFAULT '',
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 reviewed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS mega_hr_digital_forms_org_idx ON mega_hr_digital_forms(org_id,updated_at DESC);
CREATE INDEX IF NOT EXISTS mega_hr_digital_forms_lookup_idx ON mega_hr_digital_forms(org_id,role_id,form_id);
`;
const router=express.Router();
const bad=(msg,code=400)=>Object.assign(new Error(msg),{status:code});
const wrap=fn=>(req,res)=>Promise.resolve(fn(req,res)).catch(e=>{if(!e.status)console.error('HR4000 digital:',e);res.status(e.status||500).json({error:e.status?e.message:'Unable to complete this HR action.'});});
const protectedValue=v=>String(v??'').trim().slice(0,4000);
const forbidden=/social.?security|\bssn\b|date.?of.?birth|medical.?history|diagnos|immuniz|bank.?account|routing.?number|card.?number|password|passport.?number|national.?id|background.?finding/i;
function safeAnswers(template,answers){
 if(!answers||typeof answers!=='object'||Array.isArray(answers))throw bad('Invalid form answers.');
 const allowed=new Set(template.fields.filter(k=>!forbidden.test(k)));
 const result={};
 for(const [k,v] of Object.entries(answers)){
  if(!allowed.has(k))throw bad('Unapproved or restricted field: '+k);
  if(typeof v!=='string'&&typeof v!=='number'&&typeof v!=='boolean')throw bad('Form values must be plain text, numbers or booleans.');
  const value=protectedValue(v);
  if(forbidden.test(value))throw bad('Restricted sensitive information detected. Do not enter personal health, identity or financial details.');
  if(value.length>2000)throw bad('Field exceeds permitted length.');
  result[k]=value;
 }
 if(Object.keys(result).length>80)throw bad('Too many fields.');
 return result;
}
function recordId(value){const n=Number(value);if(!Number.isSafeInteger(n)||n<1)throw bad('Invalid record ID');return n;}
async function ownRecord(id,org){const r=await q('SELECT * FROM mega_hr_digital_forms WHERE id=$1 AND org_id=$2',[recordId(id),org]);if(!r.rows[0])throw bad('Record not found',404);return r.rows[0];}
router.use(requireUser,requireRole('admin','compliance_officer','clinician_reviewer'));
router.get('/records',wrap(async(req,res)=>{
 const rows=await q('SELECT id,role_id,form_id,subject_reference,status,created_by,reviewed_by,created_at,updated_at FROM mega_hr_digital_forms WHERE org_id=$1 ORDER BY updated_at DESC LIMIT 200',[req.user.org_id]);
 res.set('Cache-Control','private, no-store').json({records:rows.rows});
}));
router.get('/records/:id',wrap(async(req,res)=>{
 const record=await ownRecord(req.params.id,req.user.org_id);
 res.set('Cache-Control','private, no-store').json({record});
}));
router.post('/records',requireRole('admin','compliance_officer'),wrap(async(req,res)=>{
 const b=req.body||{};
 const template=getMegaHrForm(b.role_id,b.form_id);
 if(!template)throw bad('Unrecognized role or form template.');
 const subject_reference=protectedValue(b.subject_reference);
 if(!subject_reference||subject_reference.length>120||forbidden.test(subject_reference))throw bad('Use a non-sensitive internal HR reference, maximum 120 characters.');
 const answers=safeAnswers(template,b.answers||{});
 const r=await q(`INSERT INTO mega_hr_digital_forms(org_id,role_id,form_id,subject_reference,answers,created_by,updated_by)
 VALUES($1,$2,$3,$4,$5::jsonb,$6,$6) RETURNING id,status,updated_at`,
 [req.user.org_id,b.role_id,b.form_id,subject_reference,JSON.stringify(answers),req.user.id]);
 await audit(req,'megahr.digital_draft_created','mega_hr_digital_form',r.rows[0].id,{role_id:b.role_id,form_id:b.form_id});
 res.status(201).json({record:r.rows[0]});
}));
router.put('/records/:id',requireRole('admin','compliance_officer'),wrap(async(req,res)=>{
 const r=await ownRecord(req.params.id,req.user.org_id);
 if(!['draft','returned'].includes(r.status))throw bad('Only drafts or returned records may be edited.',409);
 const t=getMegaHrForm(r.role_id,r.form_id),answers=safeAnswers(t,req.body?.answers||{});
 const update=await q(`UPDATE mega_hr_digital_forms SET answers=$1::jsonb,status='draft',updated_by=$2,updated_at=now()
 WHERE id=$3 AND org_id=$4 AND status IN ('draft','returned') RETURNING id,status,updated_at`,
 [JSON.stringify(answers),req.user.id,r.id,req.user.org_id]);
 if(!update.rows[0])throw bad('Record changed; refresh.',409);
 await audit(req,'megahr.digital_draft_saved','mega_hr_digital_form',r.id,{});
 res.json({record:update.rows[0]});
}));
router.post('/records/:id/submit',requireRole('admin','compliance_officer'),wrap(async(req,res)=>{
 const record=await ownRecord(req.params.id,req.user.org_id);
 if(!['draft','returned'].includes(record.status))throw bad('Only draft records may be submitted.',409);
 if(!Object.keys(record.answers||{}).length)throw bad('Complete at least one permitted field before submitting.');
 const updated=await q(`UPDATE mega_hr_digital_forms SET status='submitted',updated_by=$1,updated_at=now()
 WHERE id=$2 AND org_id=$3 AND status IN ('draft','returned') RETURNING id,status`,[req.user.id,record.id,req.user.org_id]);
 if(!updated.rows[0])throw bad('Record status changed; refresh.',409);
 await audit(req,'megahr.digital_submitted','mega_hr_digital_form',record.id,{});
 res.json({record:updated.rows[0]});
}));
router.post('/records/:id/review',requireRole('admin','clinician_reviewer'),wrap(async(req,res)=>{
 const record=await ownRecord(req.params.id,req.user.org_id);
 if(record.status!=='submitted')throw bad('Only submitted records can be reviewed.',409);
 if(record.created_by===req.user.id)throw bad('The record creator cannot independently approve this submission.',403);
 const decision=req.body?.decision;
 if(!['approved','returned'].includes(decision))throw bad('Select approved or returned.');
 const note=protectedValue(req.body?.note);
 if(note.length<15||forbidden.test(note))throw bad('Provide a non-sensitive review justification (at least 15 characters).');
 const result=await q(`UPDATE mega_hr_digital_forms SET status=$1,reviewed_by=$2,review_note=$3,
 reviewed_at=now(),updated_by=$2,updated_at=now() WHERE id=$4 AND org_id=$5 AND status='submitted' RETURNING id,status`,
 [decision,req.user.id,note,record.id,req.user.org_id]);
 if(!result.rows[0])throw bad('Record was reviewed by another user.',409);
 await audit(req,'megahr.digital_'+decision,'mega_hr_digital_form',record.id,{});
 res.json({record:result.rows[0]});
}));
const lessonObjectives=p=>[
 'Locate the current approved hospital policy for '+p.title+'.',
 'Explain the role-specific responsibilities and reporting pathway.',
 'Identify evidence expected during onboarding and recurring education.',
 'Describe when to pause activity and escalate a safety or compliance question.'
];
router.get('/literature',(_req,res)=>res.json({
 status:'draft educational source briefs; not validated official policies',
 count:MEGA_HR.policies.length,
 lessons:MEGA_HR.policies.map(p=>({id:p.id,title:p.title,authority:p.authority,audience:p.audience,summary:p.lesson,objectives:lessonObjectives(p),sourceStatus:p.sourceStatus}))
}));
router.get('/literature/:id',(req,res)=>{
 const p=MEGA_HR.policies.find(x=>x.id===req.params.id);
 if(!p)return res.status(404).json({error:'Lesson not found'});
 res.json({id:p.id,title:p.title,authority:p.authority,audience:p.audience,status:'draft_training_material',
 objectives:lessonObjectives(p),
 teachingOutline:[
 'Confirm applicability to hospital services, department, state and the employee role.',
 'Review the verified source regulation separately from CMS interpretive guidance and local policy.',
 'Explain the hospital-approved process and reporting responsibilities.',
 'Conduct role-appropriate scenario discussion and observed skill assessment where applicable.',
 'Record evidence, deficiencies, remediation, reviewer and policy version.'
 ],
 knowledgeCheck:[
 {question:'Where is the currently approved policy version located?',expected:'In the facility controlled document system.'},
 {question:'What must be done when an unsafe or unclear situation is identified?',expected:'Stop if necessary and escalate through the hospital approved chain of command.'},
 {question:'Does reading a training document prove a clinical competency?',expected:'No. Competency requires the approved assessment and authentic evidence where applicable.'}
 ],
 sourceStatus:p.sourceStatus,
 releaseGate:'Review by relevant HR, clinical, infection prevention and compliance leadership required.'});
});
export {router as megaHrDigitalRouter};
