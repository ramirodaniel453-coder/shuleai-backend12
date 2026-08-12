'use strict';
module.exports={
 async up(queryInterface,Sequelize){
  const tables=await queryInterface.showAllTables(); const names=new Set(tables.map(x=>typeof x==='string'?x:(x.tableName||x.name)));
  if(names.has('Timetables')){
   const d=await queryInterface.describeTable('Timetables');
   const add=async(n,o)=>{if(!d[n])await queryInterface.addColumn('Timetables',n,o).catch(()=>{});};
   await add('status',{type:Sequelize.STRING(24),allowNull:false,defaultValue:'draft'});
   await add('version',{type:Sequelize.INTEGER,allowNull:false,defaultValue:1});
   await add('publishedAt',{type:Sequelize.DATE,allowNull:true}); await add('publishedBy',{type:Sequelize.INTEGER,allowNull:true}); await add('supersedesId',{type:Sequelize.INTEGER,allowNull:true});
   await queryInterface.sequelize.query(`UPDATE "Timetables" SET "status"=CASE WHEN "isPublished"=true THEN 'published' ELSE 'draft' END`).catch(()=>{});
   await queryInterface.addIndex('Timetables',['schoolId','term','year','scope','isPublished'],{name:'v145_timetable_active_lookup'}).catch(()=>{});
  }

  if(names.has('SubscriptionPlans')){
   const core=JSON.stringify(['dashboard','teachers','teacher_approvals','students','analytics','alerts','announcements','finance_fees','fees','payments','parent_messages','chat','school_settings','billing','subscriptions','classes','attendance','attendance_corrections','marks','grading','report_cards','report_history','calendar','school_branding','timetable','homework','duty','fairness_report','departments','bulk_sms','birthdays','curriculum','subject_selection','senior_subject_choice','academic_year_transition','promotions','transfers']);
   await queryInterface.sequelize.query(`UPDATE "SubscriptionPlans" SET "features"=CAST(:core AS JSONB), "lockedFeatures"='[]'::jsonb, "limits"=COALESCE("limits",'{}'::jsonb) || CASE WHEN lower(COALESCE("code","name",'')) LIKE '%enterprise%' THEN '{"minStudents":801,"maxStudents":null,"pricingBasis":"active_students"}'::jsonb WHEN lower(COALESCE("code","name",'')) LIKE '%growth%' THEN '{"minStudents":401,"maxStudents":800,"pricingBasis":"active_students"}'::jsonb ELSE '{"minStudents":1,"maxStudents":400,"pricingBasis":"active_students"}'::jsonb END, "updatedAt"=NOW() WHERE "ownerType"='school'`,{replacements:{core}}).catch(()=>{});
  }

  if(names.has('Alerts')){
   await queryInterface.sequelize.query(`UPDATE "Alerts" a SET "data"=COALESCE(a."data",'{}'::jsonb)||jsonb_build_object('quarantinedDuplicate',true,'duplicateOf',b."id",'quarantinedAt',NOW()) FROM "Alerts" b WHERE a."id">b."id" AND a."userId"=b."userId" AND COALESCE(a."title",'')=COALESCE(b."title",'') AND COALESCE(a."message",'')=COALESCE(b."message",'') AND COALESCE(a."type"::text,'')=COALESCE(b."type"::text,'') AND ABS(EXTRACT(EPOCH FROM (a."createdAt"-b."createdAt")))<=30`).catch(()=>{});
   await queryInterface.sequelize.query(`UPDATE "Alerts" a SET "data"=COALESCE(a."data",'{}'::jsonb)||jsonb_build_object('quarantinedDedupeKey',a."dedupeKey",'duplicateOf',b."id",'quarantinedAt',NOW()), "dedupeKey"=NULL FROM "Alerts" b WHERE a."id">b."id" AND a."userId"=b."userId" AND a."dedupeKey" IS NOT NULL AND a."dedupeKey"=b."dedupeKey"`).catch(()=>{});
   await queryInterface.sequelize.query(`CREATE UNIQUE INDEX IF NOT EXISTS "v145_alert_user_dedupe_unique" ON "Alerts" ("userId", "dedupeKey") WHERE "dedupeKey" IS NOT NULL`).catch(()=>{});
  }
 },
 async down(){
    throw new Error('Irreversible migration 20260608010000-v145-seamless-duty-timetable-alerts.js: use a verified database backup or an explicit reviewed forward-fix migration.');
  }
};
