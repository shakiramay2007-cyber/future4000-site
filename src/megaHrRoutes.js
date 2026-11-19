// Private MEGAHOSPITAL HR4000 catalog and templated orientation records.
// READ-ONLY GENERATORS: do not submit employee information into these endpoints.
import express from 'express';
import { requireUser, requireRole } from './auth.js';
import { MEGA_HR, MEGA_HR_FORM_COUNT, getMegaHrForm } from './megaHr4000.js';

export const megaHrRouter=express.Router();
megaHrRouter.use(requireUser,requireRole('admin','compliance_officer','clinician_reviewer'));
megaHrRouter.get('/catalog',(_req,res)=>{
 const {title,edition,status,note,roles,formTypes,policies,sources,rules}=MEGA_HR;
 res.json({title,edition,status,note,roles,formTypes,policies,sources,rules,formCount:MEGA_HR_FORM_COUNT});
});
megaHrRouter.get('/orientation/:roleId',(req,res)=>{
 const role=MEGA_HR.roles.find(x=>x.id===req.params.roleId);
 if(!role)return res.status(404).json({error:'Role not found'});
 const o=MEGA_HR.orientation;
 const refs=new Set([...o.common,...(o.byDepartment[role.department]||[])]);
 const policies=MEGA_HR.policies.filter(p=>refs.has(p.id));
 res.json({role,policies,requiredFields:o.fields,reviewCycle:o.reviewCycle,approvalStatus:'draft / facility review required',sourceRevision:'Verification required against current applicable federal, state and hospital standards'});
});
megaHrRouter.get('/forms/:roleId/:formId',(req,res)=>{
 const form=getMegaHrForm(req.params.roleId,req.params.formId);
 if(!form)return res.status(404).json({error:'Template not found'});
 res.json({...form,warning:'Template only. Do not enter patient data, passwords, SSN, or medical clearance details. No employee record exists until implemented within secured HR storage.'});
});
