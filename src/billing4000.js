// PAY4000: FUTURE4000-owned billing, invoicing and revenue software.
// Deliberately independent of Stripe. No payment-card data, bank routing data or funds custody.
// Payment confirmations require external evidence and an authorized administrator.
import express from 'express';
import { q } from './db.js';
import { requireUser, requireRole, audit } from './auth.js';

export const BILLING_SCHEMA = `
CREATE TABLE IF NOT EXISTS pay4000_invoices (
 id BIGSERIAL PRIMARY KEY,
 org_id BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 invoice_number TEXT NOT NULL,
 client_name TEXT NOT NULL,
 client_email TEXT NOT NULL DEFAULT '',
 description TEXT NOT NULL,
 amount_cents BIGINT NOT NULL CHECK (amount_cents > 0 AND amount_cents <= 1000000000),
 currency CHAR(3) NOT NULL DEFAULT 'USD',
 due_date DATE,
 status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','issued','void','paid')),
 payment_reference TEXT,
 payment_method TEXT,
 paid_at TIMESTAMPTZ,
 created_by BIGINT REFERENCES users(id),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(org_id, invoice_number)
);
CREATE INDEX IF NOT EXISTS pay4000_invoice_org_idx ON pay4000_invoices(org_id,created_at DESC);
CREATE TABLE IF NOT EXISTS pay4000_invoice_events (
 id BIGSERIAL PRIMARY KEY,
 org_id BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 invoice_id BIGINT NOT NULL REFERENCES pay4000_invoices(id) ON DELETE CASCADE,
 actor_id BIGINT REFERENCES users(id),
 event TEXT NOT NULL,
 notes TEXT NOT NULL DEFAULT '',
 occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pay4000_invoice_events_idx ON pay4000_invoice_events(org_id,invoice_id);
`;

const router=express.Router();
const bad=(m,code=400)=>Object.assign(new Error(m),{status:code});
const wrap=fn=>(req,res)=>Promise.resolve(fn(req,res)).catch(e=>{if(!e.status)console.error('PAY4000:',e);res.status(e.status||500).json({error:e.status?e.message:'Billing request failed.'});});
const nonempty=(v,max)=>String(v??'').trim().slice(0,max);
const invoiceId=v=>{const n=Number(v);if(!Number.isSafeInteger(n)||n<1)throw bad('Invalid invoice identifier');return n;};
const money=v=>{if(!Number.isSafeInteger(v)||v<1||v>1000000000)throw bad('Amount must be an integer of cents within allowed limits.');return v;};
const STATES={draft:['issued','void'],issued:['paid','void'],paid:[],void:[]};
async function findInvoice(id,orgId) {
 const r=await q('SELECT * FROM pay4000_invoices WHERE id=$1 AND org_id=$2',[invoiceId(id),orgId]);
 if(!r.rows[0])throw bad('Invoice not found',404);
 return r.rows[0];
}
router.use(requireUser);
router.get('/capabilities',(_req,res)=>res.json({
 name:'PAY4000',processor:'not integrated',collectsCards:false,merchantOfRecord:false,
 versions:[{id:'internal',label:'FUTURE4000 Internal Billing'},{id:'business',label:'PAY4000 Business (resellable edition planned)'}],
 functions:['tenant scoped invoices','invoice lifecycle','manual external settlement reconciliation','financial totals','audit events'],
 limits:['No live checkout','No transfer of funds','No recurring automatic charges','No processor or bank connection','Not PCI-certified']
}));
router.get('/invoices',wrap(async(req,res)=>{
 const r=await q('SELECT id,invoice_number,client_name,client_email,description,amount_cents,currency,due_date,status,created_at,paid_at FROM pay4000_invoices WHERE org_id=$1 ORDER BY created_at DESC LIMIT 200',[req.user.org_id]);
 res.json({invoices:r.rows});
}));
router.get('/dashboard',wrap(async(req,res)=>{
 const r=await q("SELECT status,count(*)::int AS count,coalesce(sum(amount_cents),0)::bigint AS amount_cents FROM pay4000_invoices WHERE org_id=$1 GROUP BY status",[req.user.org_id]);
 res.json({currency:'USD',groups:r.rows,note:'Paid is based on manual external reference, not bank-confirmed settlement.'});
}));
router.post('/invoices',requireRole('admin','compliance_officer'),wrap(async(req,res)=>{
 const b=req.body||{};
 const client_name=nonempty(b.client_name,180),description=nonempty(b.description,500),client_email=nonempty(b.client_email,190);
 if(!client_name||!description)throw bad('Client name and service description are required.');
 if(client_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(client_email))throw bad('Invalid email.');
 const amount_cents=money(b.amount_cents);
 const invoice_number='F4-'+Date.now().toString(36).toUpperCase()+'-'+Math.random().toString(36).slice(2,8).toUpperCase();
 const due_date=b.due_date==null?null:String(b.due_date);
 if(due_date&&!/^\d{4}-\d{2}-\d{2}$/.test(due_date))throw bad('Due date must use YYYY-MM-DD.');
 const r=await q(`INSERT INTO pay4000_invoices(org_id,invoice_number,client_name,client_email,description,amount_cents,due_date,created_by)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,[req.user.org_id,invoice_number,client_name,client_email,description,amount_cents,due_date,req.user.id]);
 const i=r.rows[0];
 await q("INSERT INTO pay4000_invoice_events(org_id,invoice_id,actor_id,event) VALUES($1,$2,$3,'created')",[req.user.org_id,i.id,req.user.id]);
 await audit(req,'pay4000.invoice_created','pay4000_invoice',i.id,{status:'draft'});
 res.status(201).json({invoice:i});
}));
router.get('/invoices/:id',wrap(async(req,res)=>{
 const invoice=await findInvoice(req.params.id,req.user.org_id);
 const events=await q('SELECT event,notes,occurred_at FROM pay4000_invoice_events WHERE invoice_id=$1 AND org_id=$2 ORDER BY occurred_at DESC',[invoice.id,req.user.org_id]);
 res.json({invoice,events:events.rows});
}));
router.post('/invoices/:id/status',requireRole('admin','compliance_officer'),wrap(async(req,res)=>{
 const old=await findInvoice(req.params.id,req.user.org_id);
 const status=nonempty(req.body?.status,20);
 if(!STATES[old.status].includes(status))throw bad('Unsupported status transition.',409);
 const reference=nonempty(req.body?.payment_reference,180);
 const method=nonempty(req.body?.payment_method,80);
 if(status==='paid'&&(!reference||!method))throw bad('To mark paid, specify independent settlement reference and payment method. Never enter card numbers or patient data.');
 const notes=nonempty(req.body?.notes,500);
 const r=await q(`UPDATE pay4000_invoices SET status=$1,payment_reference=CASE WHEN $1='paid' THEN $2 ELSE payment_reference END,
 payment_method=CASE WHEN $1='paid' THEN $3 ELSE payment_method END,
 paid_at=CASE WHEN $1='paid' THEN now() ELSE paid_at END,updated_at=now()
 WHERE id=$4 AND org_id=$5 AND status=$6 RETURNING *`,
 [status,reference||null,method||null,old.id,req.user.org_id,old.status]);
 if(!r.rows[0])throw bad('Invoice changed. Refresh before updating.',409);
 await q('INSERT INTO pay4000_invoice_events(org_id,invoice_id,actor_id,event,notes) VALUES($1,$2,$3,$4,$5)',[req.user.org_id,old.id,req.user.id,status,notes]);
 await audit(req,'pay4000.invoice_'+status,'pay4000_invoice',old.id,{referenceProvided:Boolean(reference)});
 res.json({invoice:r.rows[0],warning:status==='paid'?'Manual confirmation only; reconcile against bank or processor statement.':undefined});
}));
export {router as billingRouter};
