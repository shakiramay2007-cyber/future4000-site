// ZARWANGO LIBRARY4000 publication workflow.
// Drafts are private to their organization; source metadata is not proof of compliance.
import express from 'express';
import { q } from './db.js';
import { requireUser, requireRole, audit } from './auth.js';

export const PUBLICATION_SCHEMA = \`
CREATE TABLE IF NOT EXISTS publication_manuscripts (
 id BIGSERIAL PRIMARY KEY,
 org_id BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 title TEXT NOT NULL, sector TEXT NOT NULL CHECK(sector IN ('hospital','home_care','education','other')),
 author TEXT NOT NULL DEFAULT 'Lubega Zarwango, RN, MSN',
 description TEXT NOT NULL DEFAULT '', jurisdiction TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','in_review','approved')),
 source_register JSONB NOT NULL DEFAULT '[]'::jsonb,
 created_by BIGINT REFERENCES users(id),
 approved_by BIGINT REFERENCES users(id),
 approved_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_publication_manuscripts_org ON publication_manuscripts(org_id, updated_at DESC);
CREATE TABLE IF NOT EXISTS publication_chapters (
 id BIGSERIAL PRIMARY KEY, manuscript_id BIGINT NOT NULL REFERENCES publication_manuscripts(id) ON DELETE CASCADE,
 number INTEGER NOT NULL CHECK(number BETWEEN 1 AND 200), title TEXT NOT NULL,
 content TEXT NOT NULL DEFAULT '', source_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','in_review','approved')),
 reviewer_id BIGINT REFERENCES users(id), reviewed_at TIMESTAMPTZ,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(manuscript_id,number)
);
CREATE INDEX IF NOT EXISTS idx_publication_chapters_book ON publication_chapters(manuscript_id,number);
\`;

const HOME_CARE_TOC = [
'Organization Governance, Ownership, Administrative Structure, and Clinical Oversight',
'Patient Rights, Complaints, Grievances, and Abuse Prevention',
'Admission, Eligibility, Referral, Intake, and Patient Consent',
'Comprehensive Assessment, OASIS Applicability, and Reassessment',
'Plan of Care, Physician Orders, and Recertification',
'Skilled Nursing Services, Supervision, and Documentation',
'Home Health Aides, Competencies, and Supervisory Visits',
'Infection Prevention, Surveillance, and Occupational Safety',
'Medication Management, Reconciliation, and High Risk Medications',
'Emergency Preparedness, Disaster Response, and Continuity',
'Quality Assessment and Performance Improvement (QAPI)',
'Clinical Records, Confidentiality, and Health Information',
'Care Coordination, Discharge, and Transfer Processes',
'Billing Integrity, Prior Authorization, and Claims Review',
'Personnel Qualifications, Licensure, Credentialing, and Training',
'Federal and State Requirements, Survey Evidence, and Tracers',
'Performance Audits, Corrective Actions, and Record Retention',
'Forms, Competency Checklists, Approval Register, and Appendices'
];
const HOSPITAL_TOC = [
'Governing Body and Hospital Leadership',
'Patient Rights, Informed Consent, and Grievances',
'Quality Assessment and Performance Improvement',
'Medical Staff, Credentialing, and Privileging',
'Nursing Services and Staff Competency',
'Medical Records and Patient Information',
'Pharmaceutical Services and Medication Safety',
'Laboratory, Pathology, Imaging, and Radiology',
'Food and Dietetic Services',
'Physical Environment, Utilities, and Life Safety',
'Infection Prevention, Stewardship, and Surveillance',
'Discharge Planning, Utilization Review, and Transitions',
'Surgical Services and Anesthesia',
'Emergency Services, EMTALA, and Triage',
'Respiratory, Rehabilitation, and Specialty Services',
'Psychiatric Services When Applicable',
'Emergency Preparedness and Continuity of Operations',
'Survey Tracers, Evidence, CAPA, and Approval Records'
];
export const LIBRARY_TEMPLATES = Object.freeze({
 home_care: { name:'Home Care / Home Health - controlled manuscript',chapters:HOME_CARE_TOC,
  sources:['42 CFR Part 484 (applicable home health conditions)','CMS State Operations Manual Appendix B (interpretive guidance)','State licensing rules - jurisdiction to confirm','Joint Commission Home Care program - licensed standards verification required','11_Home_Care_OME.zip (existing archive; contents not verified)'] },
 hospital: { name:'Hospital - controlled manuscript',chapters:HOSPITAL_TOC,
  sources:['42 CFR Part 482 (hospital conditions)','CMS State Operations Manual Appendix A (interpretive guidance)','EMTALA and emergency preparedness as applicable','Joint Commission Hospital program - licensed standards verification required','01_Hospital_HAP.zip (existing archive; contents not verified)']}
});
export const ARCHIVE_CATALOG = Object.freeze([
['01_Hospital_HAP.zip','Hospital'],['02_Critical_Access_Hospital_CAH.zip','Critical Access Hospital'],
['03_Rural_Emergency_Hospital_REH.zip','Rural Emergency Hospital'],['04_Ambulatory_Health_Care_AHC.zip','Ambulatory Healthcare'],
['05_Office_Based_Surgery_OBS.zip','Office-Based Surgery'],['06_Assisted_Living_ALC.zip','Assisted Living'],
['07_Behavioral_Health_Care_BHC.zip','Behavioral Healthcare'],['08_Community_Health_Center_CHC.zip','Community Health Center'],
['09_Rural_Health_Clinic_RHC.zip','Rural Health Clinic'],['10_Durable_Medical_Equipment_DME.zip','Durable Medical Equipment'],
['11_Home_Care_OME.zip','Home Care'],['12_Laboratory_CLIA_LAB.zip','Laboratory'],
['13_Nursing_Care_Center_NCC.zip','Nursing Care Center'],['14_Telehealth_TEL.zip','Telehealth']
].map(([filename,setting])=>({filename,setting,sourceStatus:'archive listed; contents unverified',approval:'not verified'})));

const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const wrap=fn=>(req,res)=>Promise.resolve(fn(req,res)).catch(e=>{if(!e.status)console.error('Library4000',e);res.status(e.status||500).json({error:e.status?e.message:'Library operation failed; inspect logs.'});});
const positiveId=value=>{const n=Number(value);if(!Number.isSafeInteger(n)||n<1)throw fail('Invalid identifier');return n;};
const str=(value,max=400)=>String(value??'').trim().slice(0,max);
async function getManuscript(id,orgId) {
 const result=await q('SELECT * FROM publication_manuscripts WHERE id=$1 AND org_id=$2',[positiveId(id),orgId]);
 if(!result.rows[0])throw fail('Manuscript not found',404);
 return result.rows[0];
}

export const publicationRouter=express.Router();
publicationRouter.use(requireUser);
publicationRouter.get('/catalog',(_req,res)=>res.json({archives:ARCHIVE_CATALOG,templates:Object.keys(LIBRARY_TEMPLATES),note:'Metadata only. Original archives are not imported or published.'}));
publicationRouter.get('/manuscripts',wrap(async(req,res)=>{
 const x=await q(\`SELECT m.*, (SELECT count(*)::int FROM publication_chapters c WHERE c.manuscript_id=m.id) AS chapters, (SELECT count(*)::int FROM publication_chapters c WHERE c.manuscript_id=m.id AND c.status='approved') AS approved_chapters
 FROM publication_manuscripts m WHERE m.org_id=$1 ORDER BY m.updated_at DESC\`,[req.user.org_id]);
 res.json(x.rows);
}));
publicationRouter.post('/manuscripts',requireRole('admin','compliance_officer'),wrap(async(req,res)=>{
 const title=str(req.body?.title,240);
 const sector=str(req.body?.sector,40);
 if(title.length<5)throw fail('A descriptive manuscript title is required.');
 if(!['hospital','home_care','education','other'].includes(sector))throw fail('Choose a valid manuscript sector.');
 const template=LIBRARY_TEMPLATES[sector];
 const sources=template?template.sources.map(name=>({name,verified:false})): [];
 const x=await q(\`INSERT INTO publication_manuscripts(org_id,title,sector,description,jurisdiction,source_register,created_by)
 VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *\`,[req.user.org_id,title,sector,str(req.body?.description,2000),str(req.body?.jurisdiction,120),JSON.stringify(sources),req.user.id]);
 const m=x.rows[0];
 if(template){for(let i=0;i<template.chapters.length;i++)await q(
 'INSERT INTO publication_chapters(manuscript_id,number,title) VALUES($1,$2,$3)',
 [m.id,i+1,template.chapters[i]])}
 await audit(req,'library.manuscript_created','publication_manuscript',m.id,{sector,templateChapters:template?.chapters.length||0});
 res.status(201).json({...m,created_chapters:template?.chapters.length||0});
}));
publicationRouter.get('/manuscripts/:id',wrap(async(req,res)=>{
 const manuscript=await getManuscript(req.params.id,req.user.org_id);
 const chapters=await q('SELECT id,number,title,status,source_refs,updated_at,length(content) AS characters FROM publication_chapters WHERE manuscript_id=$1 ORDER BY number',[manuscript.id]);
 res.json({manuscript,chapters:chapters.rows});
}));
publicationRouter.get('/manuscripts/:id/chapters/:number',wrap(async(req,res)=>{
 const m=await getManuscript(req.params.id,req.user.org_id);
 const chapter=await q('SELECT * FROM publication_chapters WHERE manuscript_id=$1 AND number=$2',[m.id,positiveId(req.params.number)]);
 if(!chapter.rows[0])throw fail('Chapter not found',404);
 res.json(chapter.rows[0]);
}));
publicationRouter.put('/manuscripts/:id/chapters/:number',requireRole('admin','compliance_officer'),wrap(async(req,res)=>{
 const m=await getManuscript(req.params.id,req.user.org_id);
 if(m.status==='approved')throw fail('Approved manuscript is locked; create a revision.',409);
 const number=positiveId(req.params.number);
 const title=str(req.body?.title,240);
 const content=str(req.body?.content,250000);
 if(!title)throw fail('Chapter title required.');
 // No auto-approval, no automatic publication of submitted text.
 const x=await q(\`INSERT INTO publication_chapters(manuscript_id,number,title,content,status)
 VALUES($1,$2,$3,$4,'draft') ON CONFLICT(manuscript_id,number) DO UPDATE
 SET title=EXCLUDED.title,content=EXCLUDED.content,status='draft',reviewer_id=NULL,reviewed_at=NULL,updated_at=now()
 RETURNING id,number,title,status,updated_at\`,[m.id,number,title,content]);
 await q('UPDATE publication_manuscripts SET status=$2,updated_at=now(),approved_by=NULL,approved_at=NULL WHERE id=$1',[m.id,'draft']);
 await audit(req,'library.chapter_saved','publication_chapter',x.rows[0].id,{manuscript:m.id,number});
 res.json(x.rows[0]);
}));
publicationRouter.post('/manuscripts/:id/submit',requireRole('admin','compliance_officer'),wrap(async(req,res)=>{
 const m=await getManuscript(req.params.id,req.user.org_id);
 if(m.status!=='draft')throw fail('Only draft manuscripts can be submitted.',409);
 const ch=await q('SELECT count(*)::int AS total,count(*) FILTER(WHERE length(trim(content))>=300)::int AS filled FROM publication_chapters WHERE manuscript_id=$1',[m.id]);
 if(ch.rows[0].total===0||ch.rows[0].filled!==ch.rows[0].total)throw fail('Complete every chapter (at least 300 characters) before submitting for clinical/editorial review.',409);
 await q("UPDATE publication_manuscripts SET status='in_review',updated_at=now() WHERE id=$1",[m.id]);
 await audit(req,'library.submitted_for_review','publication_manuscript',m.id,{});
 res.json({status:'in_review',chapters:ch.rows[0].total});
}));
publicationRouter.post('/manuscripts/:id/approve',requireRole('clinician_reviewer'),wrap(async(req,res)=>{
 const m=await getManuscript(req.params.id,req.user.org_id);
 if(m.status!=='in_review')throw fail('Manuscript is not in review.',409);
 if(m.created_by===req.user.id)throw fail('The author cannot approve their own manuscript.',403);
 const reviewNotes=str(req.body?.notes,2000);
 if(reviewNotes.length<20)throw fail('Document your clinical/editorial review decision (20 characters minimum).');
 await q("UPDATE publication_manuscripts SET status='approved',approved_by=$2,approved_at=now(),updated_at=now() WHERE id=$1",[m.id,req.user.id]);
 await audit(req,'library.approved','publication_manuscript',m.id,{notes:reviewNotes});
 res.json({status:'approved',approved_by:req.user.id});
}));
