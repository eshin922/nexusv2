import assert from 'node:assert/strict';
import postgres from 'postgres';
import { assertRuntimeSafety } from '../../src/lib/config/runtime-config.ts';
assert.equal(assertRuntimeSafety().mode, 'isolated');
const sql = postgres(process.env.DATABASE_URL!, {max:3,prepare:false});
const held = await sql.reserve();
let fee: string | undefined;
let owner: any;
let original: string = "0";
let holding = false;
let pending: Promise<any> | undefined;
try {
 const {createComponentChargesAs}=await import('../../src/lib/component-charges/create.ts');
 const {updateComponentChargeCostAs}=await import('../../src/lib/component-charges/update.ts');
 const {getCostingBundle}=await import('../../src/app/actions/costing.ts');
 const {applyPricingAdjustments}=await import('../../src/app/actions/pricing-lifts.ts');
 const {costingInputFromSnapshot}=await import('../../src/lib/costing-store.ts');
 const {costBaseFingerprint}=await import('../../src/lib/pricing-cost-base.ts');
 const [actor]=await sql`select id from users where clerk_user_id='validation_clerk_pm'`;
 [owner]=await sql`select q.id as quote_id,ql.id as leaf_id,q.global_price_adj_pct from quotes q join quote_leaves ql on ql.quote_id=q.id
 where q.status='draft' and not exists(select 1 from quote_tiers t join quote_leaf_lifts l on l.tier_id=t.id where t.quote_id=q.id)
 and not exists(select 1 from quote_tiers t join assembly_leaf_overrides o on o.tier_id=t.id where t.quote_id=q.id)
 and not exists(select 1 from quote_tiers t where t.quote_id=q.id and t.tier_price_adj_pct is not null)
 order by q.id,ql.id limit 1`;
 assert.ok(owner); original=owner.global_price_adj_pct;
 const [tier]=await sql`select id from quote_tiers where quote_id=${owner.quote_id} order by sort_order limit 1`;
 const created=await createComponentChargesAs(actor.id,{quoteId:owner.quote_id,quoteLeafId:owner.leaf_id,charges:[{chargeKey:'print_plates',label:'Isolated concurrent parity probe'}]});
 assert.ok(created.ok,JSON.stringify(created)); fee=created.data.created[0].chargeInstanceId;
 const write=async(cost:string)=> { const r=await updateComponentChargeCostAs(actor.id,{quoteId:owner.quote_id,chargeInstanceId:fee!,tierId:tier.id,cost});assert.ok(r.ok,JSON.stringify(r)); };
 await write('100');
 const loaded=await getCostingBundle(owner.quote_id);assert.ok(loaded.ok,JSON.stringify(loaded));
 const economicFingerprint=costBaseFingerprint(costingInputFromSnapshot(loaded.data));
 await held`begin`; holding = true;
 const [pid]=await held`select pg_backend_pid() as pid`;
 await held`select id from quotes where id=${owner.quote_id} for update`;
 pending=applyPricingAdjustments({quoteId:owner.quote_id,lifts:[],overrides:[],tierAdjustments:[],globalAdjPct:.1234,intent:'apply',
   authorityBaseline:{globalAdj:String(Number(original)),tierAdj:[],lifts:[],overrides:[]},economicFingerprint});
 const deadline=Date.now()+5000;
 let waiting=false;
 while(Date.now()<deadline){
   const [state]=await sql`select exists(select 1 from pg_stat_activity where datname=current_database() and ${pid.pid}::int=any(pg_blocking_pids(pid))) as waiting`;
   if(state.waiting){waiting=true;break;}
   await new Promise(r=>setTimeout(r,25));
 }
 assert.ok(waiting,'Pricing never reached the controlled write barrier');
 // Existing tier row update requires no lock on the parent quote, so can land here.
 await write('800');
 await held`commit`; holding = false;
 const applied=await pending;
 const [after]=await sql`select global_price_adj_pct from quotes where id=${owner.quote_id}`;
 console.log(JSON.stringify({controlledWriteBarrier:true,costCommittedBeforePricing:true,pricingResult:applied,
   staleApplyAccepted:applied.ok,storedGlobalAdjustment:after.global_price_adj_pct}));
 assert.equal(applied.ok,false);
 if (!applied.ok) assert.equal(applied.error.code,"COSTS_STALE");
 assert.equal(Number(after.global_price_adj_pct),Number(original));

 // Real database locks must block both edits and inserts, not only Pricing callers.
 const {db,inDatabaseTransaction}=await import('../../src/db/index.ts');
 const {sql:query}=await import('drizzle-orm');
 const {lockPricingBasis}=await import('../../src/lib/pricing-basis-lock.ts');
 const live=await getCostingBundle(owner.quote_id); assert.ok(live.ok,JSON.stringify(live));
 const request={quoteId:owner.quote_id,lifts:[],overrides:[],tierAdjustments:[],globalAdjPct:.1234,intent:'apply' as const,
   authorityBaseline:{globalAdj:String(Number(original)),tierAdj:[],lifts:[],overrides:[]},
   economicFingerprint:costBaseFingerprint(costingInputFromSnapshot(live.data))};
 const missingAuthority=await applyPricingAdjustments({...request,authorityBaseline:null});
 assert.ok(!missingAuthority.ok && missingAuthority.error.code==='PRICING_STALE');
 const missingCosts=await applyPricingAdjustments({...request,economicFingerprint:null});
 assert.ok(!missingCosts.ok && missingCosts.error.code==='COSTS_STALE');
 let blocked=0;
 await inDatabaseTransaction(async tx=>{
   await lockPricingBasis(tx,owner.quote_id);
   const a=await tx.execute(query`select pg_backend_pid() as pid`);
   const b=await db.execute(query`select pg_backend_pid() as pid`);
   assert.equal(a[0].pid,b[0].pid,'readers must use the same transaction connection');
   const attempts=[
     (cx:any)=>cx`update quote_charge_instance_tiers set cost_amount=801 where charge_instance_id=${fee}`,
     (cx:any)=>cx`delete from quote_charge_instance_tiers where charge_instance_id=${fee}`,
     (cx:any)=>cx`insert into quote_charge_instance_tiers(charge_instance_id,tier_id,cost_amount)
       select ${fee},id,100 from quote_tiers where quote_id=${owner.quote_id} and id<>${tier.id} limit 1`,
     (cx:any)=>cx`insert into quote_charge_recovery(quote_id,charge_key,mode,elected_by_user_id,charge_instance_id)
       values(${owner.quote_id},'print_plates','separate',${actor.id},${fee})`,
     (cx:any)=>cx`update assembly_leaf_inputs set unit_cost=unit_cost where quote_leaf_id=${owner.leaf_id}`,
     (cx:any)=>cx`update quote_tiers set qty=qty where quote_id=${owner.quote_id}`,
     (cx:any)=>cx`update quotes set global_price_adj_pct=.2 where id=${owner.quote_id}`,
     (cx:any)=>cx`update markup_defaults set default_markup_pct=default_markup_pct`,
     (cx:any)=>cx`insert into quote_tiers(quote_id,label,qty,sort_order) values(${owner.quote_id},'Blocked tier',123,999)`,
   ];
   const [hasInputs]=await sql`select count(*)::int as n from assembly_leaf_inputs where quote_leaf_id=${owner.leaf_id}`;
   assert.ok(hasInputs.n>0,'packaging edit test requires existing rows');
   const [hasOtherTier]=await sql`select count(*)::int as n from quote_tiers where quote_id=${owner.quote_id} and id<>${tier.id}`;
   assert.ok(hasOtherTier.n>0,'insert test requires another tier');
   for(const attempt of attempts){
     await assert.rejects(sql.begin(async cx=>{await cx`set local lock_timeout='100ms'`;await attempt(cx);}),
       (e:any)=>e.code==='55P03'); blocked++;
   }
 });
 // Two simultaneous decisions from the same basis: one commits, one refuses.
 const pair=await Promise.all([applyPricingAdjustments(request),applyPricingAdjustments({...request,globalAdjPct:.2345})]);
 assert.equal(pair.filter(r=>r.ok).length,1,'only one decision from an unchanged baseline may commit');
 const rejected=pair.find(r=>!r.ok); assert.ok(rejected && !rejected.ok && rejected.error.code==='PRICING_STALE');
 const [committed]=await sql`select global_price_adj_pct from quotes where id=${owner.quote_id}`;
 // Return to baseline needs authority, but no staged economic fingerprint.
 const baseline=await applyPricingAdjustments({...request,intent:'baseline',globalAdjPct:Number(original),economicFingerprint:null,
   authorityBaseline:{...request.authorityBaseline,globalAdj:String(Number(committed.global_price_adj_pct))}});
 assert.ok(baseline.ok,JSON.stringify(baseline));
 // Rollback and nesting must retain the connection without leaking state.
 const rollbackMarker = new Error('intentional isolated rollback');
 await assert.rejects(inDatabaseTransaction(async () => {
   await db.execute(query`update quotes set global_price_adj_pct=.4567 where id=${owner.quote_id}`);
   await inDatabaseTransaction(async nested => {
     const rows = await nested.execute(query`select global_price_adj_pct from quotes where id=${owner.quote_id}`);
     assert.equal(Number(rows[0].global_price_adj_pct),.4567);
   });
   throw rollbackMarker;
 }), e => e === rollbackMarker);
 const restored = await db.execute(query`select global_price_adj_pct from quotes where id=${owner.quote_id}`);
 assert.equal(Number(restored[0].global_price_adj_pct),Number(original));
 // More concurrent scopes than pool connections must drain without starving
 // readers. Other quotes must remain independently lockable while A is held.
 const others = await sql`select id from quotes where status='draft' and id<>${owner.quote_id} order by id limit 4`;
 assert.equal(others.length,4);
 await held`begin`; holding=true;
 await held`select id from quotes where id=${owner.quote_id} for update`;
 const busy=await applyPricingAdjustments(request);
 assert.ok(!busy.ok && busy.error.code==='COSTS_STALE',JSON.stringify(busy));
 await Promise.all(others.map(other => inDatabaseTransaction(async tx => {
   await lockPricingBasis(tx,other.id);
   const rows=await db.execute(query`select id from quotes where id=${other.id}`);
   assert.equal(rows[0].id,other.id);
 })));
 await held`rollback`; holding=false;
 console.log(JSON.stringify({blockedCostMutations:blocked,missingBasesRefused:true,transactionConnectionShared:true,
   concurrentPricing:'one success, one stale refusal',returnToBaseline:'pass',rollback:'pass',poolSaturation:'pass',busyRefusal:'pass'}));
} finally {
 if (holding) await held`rollback`; held.release();
 if(pending) await pending;
 if(owner) await sql`update quotes set global_price_adj_pct=${original!} where id=${owner.quote_id}`;
 if(fee) await sql`delete from quote_charge_instances where id=${fee}`;
 await sql.end();
}
process.exit(0);
