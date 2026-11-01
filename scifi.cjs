'use strict';
// School sci-fi activity: separate submissions from the byte-storage upload pipeline.
const crypto=require('node:crypto');
const {randomUUID,randomBytes,createHash,timingSafeEqual}=crypto;
const fs=require('node:fs');
const path=require('node:path');
const EVENT='scifi-2026';
const initialCategories=[
 ['novel','科幻小说','文学类','以科学技术的未来发展及其影响为背景，展开富有想象力的未来世界故事。','2000—30000 字；DOCX/PDF；个人独立原创，严禁使用 AI 创作。','docx,pdf',0],
 ['essay','科幻作文','文学类','描绘中国和世界的美好未来，或未来理想生活。','500—1000 字；DOCX/PDF；个人独立原创，严禁使用 AI 创作。','docx,pdf',0],
 ['painting','科幻绘画','绘画类','以“我和我的未来”为主题，展现未来充满科技感的生活。','原创手绘扫描 JPG，300dpi；禁止 AI 生成及非手绘数字创作。','jpg,jpeg',0],
 ['creative','科幻文创科创','创意类','征集科技发明、创意产品、桌游、模型及其他科幻文创科创项目。','提交作品说明；涉及实物展示的视频限 MP4、3 分钟以内、1920×1080；可提供辅助附件。','pdf,docx,jpg,jpeg,png,mp4,zip',1],
 ['aigc','AIGC 科幻动画','创意类','围绕未来科技、宇宙探索、未来生活创作 AI 辅助动画。','MP4；30 秒—5 分钟；至少 1080P；无水印和广告；200 字以内创作说明（含使用的 AI 工具）。','mp4',1],
 ['tianfu','天府科普研学游','专项类','结合四川科普场馆、科研院所、科创基地与科教文旅资源的原创研学作品。','须选择具体作品形式，并遵守该形式对应的文学、绘画或创意要求；专项细分规则待主办方确认。','docx,pdf,jpg,jpeg,png,mp4,zip',1]
];
const specialTypes=['研学游记','研学故事','主题绘画','科普短视频','AI 动画','研学线路创意'];
module.exports=function mount({app,base,db,auth,admin,now,clean,fail,audit,cfg,limit,DATA}){
 db.exec(
 'CREATE TABLE IF NOT EXISTS scifi_event (id TEXT PRIMARY KEY,title TEXT NOT NULL,description TEXT NOT NULL,deadline TEXT NOT NULL,open INTEGER NOT NULL DEFAULT 1);'+
 'CREATE TABLE IF NOT EXISTS scifi_categories (id TEXT PRIMARY KEY,group_name TEXT NOT NULL,title TEXT NOT NULL,description TEXT NOT NULL,rules TEXT NOT NULL,extensions TEXT NOT NULL,allow_team INTEGER NOT NULL DEFAULT 0,enabled INTEGER NOT NULL DEFAULT 1);'+
 'CREATE TABLE IF NOT EXISTS scifi_submissions (id TEXT PRIMARY KEY,event_id TEXT NOT NULL REFERENCES scifi_event(id),category_id TEXT NOT NULL REFERENCES scifi_categories(id),user_id TEXT NOT NULL REFERENCES users(id),grade TEXT NOT NULL,class_name TEXT NOT NULL,student_name TEXT NOT NULL,work_title TEXT NOT NULL,work_type TEXT NOT NULL DEFAULT "",is_team INTEGER NOT NULL DEFAULT 0,members TEXT NOT NULL DEFAULT "[]",statement TEXT NOT NULL DEFAULT "",status TEXT NOT NULL DEFAULT "draft",receipt_hash TEXT,created TEXT NOT NULL,submitted TEXT);'+
 'CREATE TABLE IF NOT EXISTS scifi_files (submission_id TEXT NOT NULL REFERENCES scifi_submissions(id),upload_id TEXT UNIQUE NOT NULL REFERENCES uploads(id),PRIMARY KEY(submission_id,upload_id));'+
 'CREATE INDEX IF NOT EXISTS scifi_owner ON scifi_submissions(user_id,created);'+
 'CREATE INDEX IF NOT EXISTS scifi_filters ON scifi_submissions(status,category_id,grade,class_name,submitted);'
 );
 db.prepare('INSERT OR IGNORE INTO scifi_event(id,title,description,deadline,open) VALUES (?,?,?,?,1)')
 .run(EVENT,'“拓科学教育新路，促想象力提升”科幻创作征集活动','发挥科学想象力，创作属于自己的未来世界。','2027-01-10T23:59:59+08:00');
 const addCategory=db.prepare('INSERT OR IGNORE INTO scifi_categories(id,title,group_name,description,rules,extensions,allow_team) VALUES (?,?,?,?,?,?,?)');
 for(const x of initialCategories)addCategory.run(x[0],x[1],x[2],x[3],x[4],x[5],x[6]);
 const getEvent=()=>db.prepare('SELECT * FROM scifi_event WHERE id=?').get(EVENT);
 const getCategories=()=>db.prepare("SELECT * FROM scifi_categories ORDER BY CASE id WHEN 'novel' THEN 1 WHEN 'essay' THEN 2 WHEN 'painting' THEN 3 WHEN 'creative' THEN 4 WHEN 'aigc' THEN 5 ELSE 6 END").all();
 const parseMembers=v=>{
  if(!Array.isArray(v)||v.length>10)throw fail(400,'团队人数超过限制');
  return v.map(p=>{const name=clean(p?.name,40),grade=clean(p?.grade,20),className=clean(p?.className,20);if(!name||!grade||!className)throw fail(400,'请完整填写团队成员信息');return {name,grade,className};});
 };
 const categoryFor=id=>db.prepare('SELECT * FROM scifi_categories WHERE id=?').get(id);
 const ensureOpen=()=>{
  const e=getEvent();
  if(!e.open||!cfg().open)throw fail(403,'活动投稿暂未开放');
  if(Date.now()>Date.parse(e.deadline))throw fail(403,'活动征集已截止');
 };
 const own=(req,id)=>{
  const s=db.prepare('SELECT * FROM scifi_submissions WHERE id=?').get(id);
  if(!s||(s.user_id!==req.user.id&&req.user.role!=='admin'))throw fail(404,'未找到这份作品');
  return s;
 };
 const filesFor=id=>db.prepare('SELECT f.id,f.filename,f.size,f.mime,f.status,f.sha256,f.created FROM scifi_files sf JOIN uploads f ON sf.upload_id=f.id WHERE sf.submission_id=? ORDER BY f.created').all(id);
 const publicSub=s=>({id:s.id,categoryId:s.category_id,grade:s.grade,className:s.class_name,studentName:s.student_name,workTitle:s.work_title,workType:s.work_type,isTeam:!!s.is_team,members:JSON.parse(s.members),statement:s.statement,status:s.status,created:s.created,submitted:s.submitted,files:filesFor(s.id)});
 app.get(base+'/scifi/activity',(req,res)=>{
  const event=getEvent();
  res.json({event:{id:event.id,title:event.title,description:event.description,deadline:event.deadline,open:!!event.open&&!!cfg().open&&Date.now()<=Date.parse(event.deadline)},categories:getCategories().filter(x=>x.enabled).map(x=>({id:x.id,title:x.title,group:x.group_name,description:x.description,rules:x.rules,extensions:x.extensions,allowTeam:!!x.allow_team})),specialTypes});
 });
 app.post(base+'/scifi/submissions',auth,(req,res)=>{
  limit('scifi:create:'+req.user.id,30,3600000);ensureOpen();
  const b=req.body,c=categoryFor(b.categoryId);
  if(!c||!c.enabled)throw fail(400,'请选择有效的作品类别');
  const grade=clean(b.grade,20),className=clean(b.className,20),studentName=clean(b.studentName,40),workTitle=clean(b.workTitle,100),statement=clean(b.statement,1500);
  if(!grade||!className||!studentName||!workTitle)throw fail(400,'请填写年级、班级、姓名和作品名称');
  const team=!!b.isTeam;if(team&&!c.allow_team)throw fail(400,'该类别不支持团队投稿');
  const members=team?parseMembers(b.members):[];
  if(team&&!members.length)throw fail(400,'请填写团队成员');
  const workType=clean(b.workType,30);
  if(c.id==='tianfu'&&!specialTypes.includes(workType))throw fail(400,'请选择专项作品形式');
  if(c.id==='aigc'&&Array.from(statement).length>200)throw fail(400,'创作说明请控制在 200 字内');
  const s={id:randomUUID(),event_id:EVENT,category_id:c.id,user_id:req.user.id,grade,class_name:className,student_name:studentName,work_title:workTitle,work_type:workType,is_team:team?1:0,members:JSON.stringify(members),statement,status:'draft',created:now()};
  db.prepare('INSERT INTO scifi_submissions(id,event_id,category_id,user_id,grade,class_name,student_name,work_title,work_type,is_team,members,statement,status,created) VALUES (@id,@event_id,@category_id,@user_id,@grade,@class_name,@student_name,@work_title,@work_type,@is_team,@members,@statement,@status,@created)').run(s);
  audit(req,'scifi_draft',null,{submission:s.id,category:c.id});
  res.status(201).json(publicSub(s));
 });
 app.get(base+'/scifi/submissions',auth,(req,res)=>{
  const all=db.prepare('SELECT * FROM scifi_submissions WHERE user_id=? ORDER BY created DESC LIMIT 100').all(req.user.id);
  res.json({submissions:all.map(publicSub)});
 });
 app.get(base+'/scifi/submissions/:id',auth,(req,res)=>res.json(publicSub(own(req,req.params.id))));
 app.post(base+'/scifi/submissions/:id/files',auth,(req,res)=>{
  const s=own(req,req.params.id);ensureOpen();
  if(s.status!=='draft')throw fail(409,'该作品已正式提交');
  const f=db.prepare('SELECT * FROM uploads WHERE id=?').get(String(req.body.uploadId||''));
  if(!f||f.user_id!==req.user.id||f.status!=='complete')throw fail(400,'请先完整上传本人文件');
  const n=db.prepare('SELECT COUNT(*) n FROM scifi_files WHERE submission_id=?').get(s.id).n;
  if(n>=10)throw fail(400,'每份作品最多添加 10 个文件');
  const already=db.prepare('SELECT * FROM scifi_files WHERE upload_id=?').get(f.id);
  if(already&&already.submission_id!==s.id)throw fail(409,'此文件已关联其他作品');
  db.prepare('INSERT OR IGNORE INTO scifi_files(submission_id,upload_id) VALUES (?,?)').run(s.id,f.id);
  res.json(publicSub(s));
 });
 app.post(base+'/scifi/submissions/:id/submit',auth,(req,res)=>{
  const s=own(req,req.params.id);ensureOpen();
  if(s.status!=='draft')throw fail(409,'该作品已经提交');
  const c=categoryFor(s.category_id),files=filesFor(s.id);
  if(!files.length)throw fail(400,'请至少上传一个完整的作品文件');
  if(files.some(f=>f.status!=='complete'))throw fail(400,'仍有未完成的附件');
  // Business-format and attachment-count rules are guidance only at the collection stage.
  // Preserve completed-file and access checks without blocking a participant's submission.
  const secret=randomBytes(24).toString('base64url');
  db.prepare("UPDATE scifi_submissions SET status='submitted',submitted=?,receipt_hash=? WHERE id=?").run(now(),createHash('sha256').update(secret).digest('hex'),s.id);
  audit(req,'scifi_submit',null,{submission:s.id,category:c.id,files:files.length});
  res.json({submission:publicSub(own(req,s.id)),receiptKey:secret});
 });
 app.get(base+'/scifi/receipt/:id',(req,res)=>{
  limit('scifi:receipt:'+req.ip,40,60000);
  const s=db.prepare("SELECT * FROM scifi_submissions WHERE id=? AND status='submitted'").get(req.params.id);
  const key=String(req.get('X-Receipt-Key')||'');
  const received=createHash('sha256').update(key).digest();
  const expected=Buffer.from(s?.receipt_hash||'0'.repeat(64),'hex');
  if(!s||!key||!timingSafeEqual(received,expected))throw fail(404,'回执无效或尚未提交');
  res.json({id:s.id,workTitle:s.work_title,categoryId:s.category_id,status:s.status,submitted:s.submitted,files:filesFor(s.id).map(f=>({filename:f.filename,size:f.size}))});
 });
 const filter=req=>{
  let sql='1=1',args=[];
  for(const [key,col]of [['category','s.category_id'],['grade','s.grade'],['className','s.class_name'],['status','s.status']]){
   const v=clean(req.query[key],50);if(v){sql+=' AND '+col+'=?';args.push(v);}
  }
  const q=clean(req.query.q,100);if(q){sql+=' AND (s.student_name LIKE ? OR s.work_title LIKE ? OR s.id LIKE ?)';args.push('%'+q+'%','%'+q+'%','%'+q+'%');}
  return {sql,args};
 };
 app.get(base+'/admin/scifi/summary',auth,admin,(req,res)=>{
  const counts=db.prepare("SELECT category_id category,COUNT(*) count FROM scifi_submissions WHERE status='submitted' GROUP BY category_id").all();
  const total=db.prepare("SELECT COUNT(*) n FROM scifi_submissions WHERE status='submitted'").get().n;
  const drafts=db.prepare("SELECT COUNT(*) n FROM scifi_submissions WHERE status='draft'").get().n;
  res.json({total,drafts,counts,activity:getEvent()});
 });
 app.get(base+'/admin/scifi/submissions',auth,admin,(req,res)=>{
  const {sql,args}=filter(req),limitNum=Math.min(100,Math.max(1,Number(req.query.limit)||25)),offset=Math.max(0,Number(req.query.offset)||0);
  const from=' FROM scifi_submissions s WHERE '+sql;
  const rows=db.prepare('SELECT s.id,s.category_id categoryId,s.grade,s.class_name className,s.student_name studentName,s.work_title workTitle,s.work_type workType,s.status,s.created,s.submitted,(SELECT COUNT(*) FROM scifi_files sf WHERE sf.submission_id=s.id) fileCount'+from+' ORDER BY s.created DESC LIMIT ? OFFSET ?').all(...args,limitNum,offset);
  res.json({total:db.prepare('SELECT COUNT(*) n'+from).get(...args).n,submissions:rows});
 });
 app.get(base+'/admin/scifi/submissions/:id',auth,admin,(req,res)=>{
  const s=db.prepare('SELECT * FROM scifi_submissions WHERE id=?').get(req.params.id);
  if(!s)throw fail(404,'找不到作品');
  res.json(publicSub(s));
 });
 const csvCell=v=>{let s=String(v??'');if(/^[=+@\-\t\r]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};
 app.get(base+'/admin/scifi/submissions.csv',auth,admin,(req,res)=>{
  const {sql,args}=filter(req);
  const rows=db.prepare('SELECT s.* FROM scifi_submissions s WHERE '+sql+' ORDER BY s.created DESC LIMIT 20000').all(...args);
  const cols=['作品编号','状态','类别','年级','班级','姓名','作品名称','专项形式','团队成员','创作说明','附件名称','提交时间'];
  const lines=[cols.map(csvCell).join(',')];
  for(const s of rows){const c=categoryFor(s.category_id);const files=filesFor(s.id);const values=[s.id,s.status,c?.title,s.grade,s.class_name,s.student_name,s.work_title,s.work_type,s.members,s.statement,files.map(f=>f.filename).join('；'),s.submitted||s.created];lines.push(values.map(csvCell).join(','));}
  audit(req,'scifi_export',null,{count:rows.length});
  res.type('text/csv; charset=utf-8').attachment('科幻作品收件清单.csv').send('\uFEFF'+lines.join('\r\n'));
 });
 app.get(base+'/admin/scifi/settings',auth,admin,(req,res)=>res.json({event:getEvent(),categories:getCategories()}));
 app.patch(base+'/admin/scifi/settings',auth,admin,(req,res)=>{
  const b=req.body;const current=getEvent();const title=clean(b.title??current.title,150),description=clean(b.description??current.description,2000),deadline=clean(b.deadline??current.deadline,50),open=b.open===undefined?current.open:(b.open?1:0);
  if(!title||!Number.isFinite(Date.parse(deadline)))throw fail(400,'活动名称或截止时间无效');
  db.prepare('UPDATE scifi_event SET title=?,description=?,deadline=?,open=? WHERE id=?').run(title,description,deadline,open,EVENT);
  audit(req,'scifi_settings',null,{deadline,open:!!open});res.json({event:getEvent()});
 });
 app.patch(base+'/admin/scifi/categories/:id',auth,admin,(req,res)=>{
  const c=categoryFor(req.params.id);if(!c)throw fail(404,'类别不存在');
  const description=clean(req.body.description??c.description,1200),rules=clean(req.body.rules??c.rules,1500),enabled=req.body.enabled===undefined?c.enabled:(req.body.enabled?1:0);
  db.prepare('UPDATE scifi_categories SET description=?,rules=?,enabled=? WHERE id=?').run(description,rules,enabled,c.id);
  audit(req,'scifi_category_settings',null,{category:c.id});res.json({category:categoryFor(c.id)});
 });
};
