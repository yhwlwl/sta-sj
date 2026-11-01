'use strict';
const express=require('express'), Database=require('better-sqlite3'), {ZipFile}=require('yazl');
const fs=require('node:fs'), fsp=fs.promises, path=require('node:path'), crypto=require('node:crypto');
const {pipeline}=require('node:stream/promises'), {Transform}=require('node:stream'), {promisify}=require('node:util');
const scrypt=promisify(crypto.scrypt), app=express();
const DATA=path.resolve(process.env.SJ_DATA||path.join(__dirname,'data'));
for(const p of ['objects','chunks','backups'])fs.mkdirSync(path.join(DATA,p),{recursive:true,mode:0o700});
const db=new Database(path.join(DATA,'collection.sqlite'));
db.pragma('journal_mode = WAL');db.pragma('foreign_keys = ON');db.pragma('busy_timeout = 5000');
db.exec(`CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,username TEXT UNIQUE,name TEXT NOT NULL,pass TEXT,role TEXT NOT NULL DEFAULT 'user',disabled INTEGER NOT NULL DEFAULT 0,created TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS uploads(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),filename TEXT NOT NULL,mime TEXT NOT NULL,size INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'uploading',category TEXT NOT NULL,note TEXT NOT NULL DEFAULT '',sha256 TEXT,created TEXT NOT NULL,completed TEXT,ip TEXT NOT NULL,received INTEGER NOT NULL DEFAULT 0,trashed TEXT);
CREATE TABLE IF NOT EXISTS chunks(upload_id TEXT NOT NULL REFERENCES uploads(id),idx INTEGER NOT NULL,size INTEGER NOT NULL,sha256 TEXT NOT NULL,PRIMARY KEY(upload_id,idx));
CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY AUTOINCREMENT,created TEXT NOT NULL,actor_id TEXT,actor TEXT NOT NULL,event TEXT NOT NULL,file_id TEXT,ip TEXT NOT NULL,details TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS tickets(hash TEXT PRIMARY KEY,user_id TEXT NOT NULL,ids TEXT NOT NULL,kind TEXT NOT NULL,expires INTEGER NOT NULL,used INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS uploads_owner ON uploads(user_id,created);
CREATE INDEX IF NOT EXISTS audit_created ON audit(created);
CREATE INDEX IF NOT EXISTS audit_event ON audit(event,created);`);
const defaults={title:'素材征集',notice:'请提交原始文件。图片与视频不会被压缩或转码；请勿提交与本次征集无关的内容。',open:true,guests:true,registration:true,maxFileMB:1024,quotaGB:8};
for(const [k,v] of Object.entries(defaults))db.prepare('INSERT OR IGNORE INTO settings VALUES (?,?)').run(k,JSON.stringify(v));
const cfg=()=>Object.fromEntries(db.prepare('SELECT * FROM settings').all().map(x=>[x.key,JSON.parse(x.value)]));
const now=()=>new Date().toISOString(), uid=()=>crypto.randomUUID(), hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const CHUNK=8*1024*1024, base='/sj-api/v1', locks=new Set();
const origins=new Set(['https://sj.stacdqz.tech','https://sj-collection.pages.dev','https://pan.tantantan.tech',...(process.env.SJ_ORIGINS||'').split(',').filter(Boolean)]);
app.disable('x-powered-by');app.set('trust proxy','loopback');
app.use((req,res,next)=>{
 const origin=req.get('Origin');
 if(origin&&!origins.has(origin))return res.status(403).json({error:'请求来源不受支持'});
 if(origin){res.set('Access-Control-Allow-Origin',origin);res.vary('Origin');}
 res.set({'Access-Control-Allow-Methods':'GET, POST, PUT, PATCH, DELETE, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type, X-Chunk-SHA256, X-Receipt-Key','Access-Control-Max-Age':'600','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});
 if(req.method==='OPTIONS')return res.sendStatus(204);
 next();
});
app.use(express.json({limit:'24kb'}));
app.use((req,res,next)=>{if(!req.body)req.body={};next();});
const fail=(status,message)=>Object.assign(new Error(message),{status});
const rates=new Map();
function limit(key,max,period){const t=Date.now(),r=rates.get(key);if(!r||r.until<t){rates.set(key,{n:1,until:t+period});return;}if(++r.n>max)throw fail(429,'操作太频繁，请稍后再试');}
function audit(req,event,fileId=null,details={}){
 db.prepare('INSERT INTO audit(created,actor_id,actor,event,file_id,ip,details) VALUES (?,?,?,?,?,?,?)').run(now(),req.user?.id||null,req.user?.name||'未登录',event,fileId,req.ip||'',JSON.stringify(details));
}
function safeUser(u){return {id:u.id,username:u.username,name:u.name,role:u.role,created:u.created};}
async function passwordHash(p){const salt=crypto.randomBytes(16).toString('hex');return salt+':'+Buffer.from(await scrypt(p,salt,64)).toString('hex');}
async function passwordOK(p,stored){if(!stored||typeof p!=='string'||p.length>128)return false;const [salt,h]=stored.split(':');const actual=Buffer.from(await scrypt(p,salt,64));const expected=Buffer.from(h,'hex');return expected.length===actual.length&&crypto.timingSafeEqual(expected,actual);}
function checkPassword(p){if(typeof p!=='string'||p.length<10||p.length>128)throw fail(400,'密码请使用 10–128 个字符');}
function clean(s,max=200){return String(s||'').normalize('NFC').replace(/[\x00-\x1f\x7f]/g,'').trim().slice(0,max);}
function username(s){const n=clean(s,40).toLowerCase();if(!/^[a-z0-9_][a-z0-9_.-]{2,39}$/.test(n))throw fail(400,'账号需为 3–40 位字母、数字、下划线或短横线');return n;}
function issue(req,u){const token=crypto.randomBytes(32).toString('base64url'),ttl=u.role==='admin'?7200000:7*86400000;db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(hash(token),u.id,Date.now()+ttl);req.user=u;return {token,user:safeUser(u),expires:Date.now()+ttl};}
function auth(req,res,next){try{const token=(req.get('Authorization')||'').replace(/^Bearer /,'');const u=db.prepare('SELECT users.* FROM sessions JOIN users ON users.id=sessions.user_id WHERE sessions.hash=? AND sessions.expires>? AND users.disabled=0').get(hash(token),Date.now());if(!u)throw fail(401,'登录已过期，请重新登录');req.user=u;req.tokenHash=hash(token);next();}catch(e){next(e);}}
function admin(req,res,next){if(req.user.role!=='admin')return next(fail(403,'需要管理员权限'));next();}
function owned(req,id){const f=db.prepare('SELECT * FROM uploads WHERE id=?').get(id);if(!f||(f.user_id!==req.user.id&&req.user.role!=='admin'))throw fail(404,'找不到该文件');return f;}
function storage(){const used=db.prepare("SELECT COALESCE(SUM(size),0) n FROM uploads WHERE status IN ('complete','uploading','trash')").get().n;const stat=fs.statfsSync(DATA);return {used,free:Number(stat.bavail)*Number(stat.bsize),quota:cfg().quotaGB*1024**3};}
const setupPath=path.join(DATA,'setup-token');
if(!db.prepare("SELECT id FROM users WHERE role='admin'").get()&&!fs.existsSync(setupPath))fs.writeFileSync(setupPath,crypto.randomBytes(32).toString('base64url'),{mode:0o600,flag:'wx'});
app.get(base+'/health',(req,res)=>res.json({ok:true,version:'1.0.0',region:'cn-chengdu'}));
app.get(base+'/meta',(req,res)=>{const c=cfg();res.json({...c,chunkSize:CHUNK,setupRequired:!db.prepare("SELECT id FROM users WHERE role='admin'").get()});});
app.post(base+'/auth/setup',async(req,res)=>{
 limit('setup:'+req.ip,8,15*60000);
 if(db.prepare("SELECT id FROM users WHERE role='admin'").get()||!fs.existsSync(setupPath))throw fail(409,'管理员已初始化');
 if(typeof req.body.token!=='string'||hash(req.body.token)!==hash(fs.readFileSync(setupPath,'utf8').trim()))throw fail(403,'初始化凭证无效');
 const name=username(req.body.username);checkPassword(req.body.password);const pass=await passwordHash(req.body.password);
 // Recheck after the asynchronous password hash to prevent competing setup requests.
 const user=db.transaction(()=>{if(db.prepare("SELECT id FROM users WHERE role='admin'").get())throw fail(409,'管理员已初始化');const u={id:uid(),username:name,name:clean(req.body.name,60)||'管理员',role:'admin',created:now()};db.prepare('INSERT INTO users(id,username,name,pass,role,created) VALUES (?,?,?,?,?,?)').run(u.id,u.username,u.name,pass,u.role,u.created);return u;})();
 fs.unlinkSync(setupPath);const result=issue(req,user);audit(req,'admin_setup');res.json(result);
});
app.post(base+'/auth/register',async(req,res)=>{
 limit('register:'+req.ip,40,3600000);if(!cfg().registration)throw fail(403,'暂未开放注册');const name=username(req.body.username);checkPassword(req.body.password);
 if(db.prepare('SELECT id FROM users WHERE username=?').get(name))throw fail(409,'该账号已存在');
 const pass=await passwordHash(req.body.password),u={id:uid(),username:name,name:clean(req.body.name,60)||name,role:'user',created:now()};
 try{db.prepare('INSERT INTO users(id,username,name,pass,role,created) VALUES (?,?,?,?,?,?)').run(u.id,u.username,u.name,pass,u.role,u.created);}catch(e){if(e.code?.includes('CONSTRAINT'))throw fail(409,'该账号已存在');throw e;}
 const result=issue(req,u);audit(req,'register');res.json(result);
});
app.post(base+'/auth/login',async(req,res)=>{
 limit('login:'+req.ip,20,15*60000);const name=clean(req.body.username,40).toLowerCase(),p=req.body.password;
 const u=db.prepare('SELECT * FROM users WHERE username=?').get(name);
 if(typeof p!=='string'||p.length>128||!u||u.disabled||!(await passwordOK(p,u.pass))){audit(req,'login_failed',null,{username:name});throw fail(401,'账号或密码不正确');}
 const result=issue(req,u);audit(req,'login');res.json(result);
});
app.post(base+'/auth/guest',(req,res)=>{
 limit('guest:'+req.ip,100,3600000);if(!cfg().guests)throw fail(403,'暂未开放游客投稿');
 const u={id:uid(),username:null,name:clean(req.body.name,60)||'游客',role:'guest',created:now()};db.prepare('INSERT INTO users(id,username,name,role,created) VALUES (?,?,?,?,?)').run(u.id,u.username,u.name,u.role,u.created);
 const result=issue(req,u);audit(req,'guest_login');res.json(result);
});
app.get(base+'/me',auth,(req,res)=>res.json({user:safeUser(req.user)}));
app.post(base+'/auth/logout',auth,(req,res)=>{audit(req,'logout');db.prepare('DELETE FROM sessions WHERE hash=?').run(req.tokenHash);res.json({ok:true});});
app.post(base+'/auth/password',auth,async(req,res)=>{if(req.user.role==='guest')throw fail(403,'游客无密码');limit('password:'+req.user.id,8,3600000);if(!(await passwordOK(req.body.currentPassword,req.user.pass)))throw fail(400,'当前密码不正确');checkPassword(req.body.password);const pass=await passwordHash(req.body.password);db.transaction(()=>{db.prepare('UPDATE users SET pass=? WHERE id=?').run(pass,req.user.id);db.prepare('DELETE FROM sessions WHERE user_id=?').run(req.user.id);})();audit(req,'password_change');res.json({...issue(req,req.user),ok:true});});
app.post(base+'/events',auth,(req,res)=>{if(req.body.event!=='page_view')throw fail(400,'无效事件');limit('view:'+req.user.id,10,60000);audit(req,'page_view',null,{page:clean(req.body.page,40)});res.json({ok:true});});
app.post(base+'/uploads',auth,(req,res)=>{
 limit('init:'+req.ip,50,3600000);const c=cfg();if(!c.open)throw fail(403,'本次征集暂未开放');
 const size=Number(req.body.size),filename=clean(req.body.filename,200).replace(/[\/\\]/g,'_');
 if(!filename||!Number.isSafeInteger(size)||size<1||size>c.maxFileMB*1024**2)throw fail(400,'文件大小不符合当前限制');
 const daily=db.prepare("SELECT COUNT(*) n,COALESCE(SUM(size),0) bytes FROM uploads WHERE user_id=? AND created>? AND status!='cancelled'").get(req.user.id,new Date(Date.now()-86400000).toISOString());
 if(req.user.role!=='admin'&&(daily.n>=(req.user.role==='guest'?30:100)||daily.bytes+size>(req.user.role==='guest'?2:5)*1024**3))throw fail(429,'今日投稿额度已用完，请明天再试或联系管理员');
 const s=storage();if(s.used+size>s.quota||s.free-size<3*1024**3)throw fail(507,'收件空间不足，请联系管理员');
 const f={id:uid(),user_id:req.user.id,filename,mime:clean(req.body.mime,100)||'application/octet-stream',size,status:'uploading',category:['image','video','other'].includes(req.body.category)?req.body.category:'other',note:clean(req.body.note,1500),created:now(),ip:req.ip};
 db.prepare('INSERT INTO uploads(id,user_id,filename,mime,size,status,category,note,created,ip) VALUES (@id,@user_id,@filename,@mime,@size,@status,@category,@note,@created,@ip)').run(f);
 fs.mkdirSync(path.join(DATA,'chunks',f.id),{mode:0o700});audit(req,'upload_start',f.id,{filename,size});res.status(201).json({...f,chunkSize:CHUNK,chunks:Math.ceil(size/CHUNK)});
});
app.get(base+'/uploads',auth,(req,res)=>res.json({files:db.prepare("SELECT id,filename,mime,size,status,category,note,sha256,created,completed,received FROM uploads WHERE user_id=? AND status NOT IN ('purged','cancelled') ORDER BY created DESC LIMIT 200").all(req.user.id)}));
app.get(base+'/uploads/:id',auth,(req,res)=>{const f=owned(req,req.params.id);res.json({...f,chunks:db.prepare('SELECT idx,size,sha256 FROM chunks WHERE upload_id=? ORDER BY idx').all(f.id)});});
app.put(base+'/uploads/:id/chunks/:index',auth,async(req,res)=>{
 const f=owned(req,req.params.id),idx=Number(req.params.index),key=f.id+':'+idx;
 if(f.status!=='uploading')throw fail(409,'该文件已不能继续上传');
 if(!Number.isInteger(idx)||idx<0||idx>=Math.ceil(f.size/CHUNK))throw fail(400,'分片编号无效');
 const expected=Math.min(CHUNK,f.size-idx*CHUNK),declared=Number(req.get('Content-Length'));
 if(declared!==expected)throw fail(400,'分片大小不正确');if(locks.has(key))throw fail(409,'该分片正在传输，请稍后重试');
 const existing=db.prepare('SELECT * FROM chunks WHERE upload_id=? AND idx=?').get(f.id,idx);
 if(existing){req.resume();return res.json({ok:true,idx,sha256:existing.sha256,already:true});}
 locks.add(key);const file=path.join(DATA,'chunks',f.id,String(idx)),temp=file+'.tmp',h=crypto.createHash('sha256');let bytes=0;
 try{
  if(fs.existsSync(temp))await fsp.unlink(temp);
  const meter=new Transform({transform(chunk,enc,cb){bytes+=chunk.length;if(bytes>expected)return cb(fail(413,'分片超出限制'));h.update(chunk);cb(null,chunk);}});
  await pipeline(req,meter,fs.createWriteStream(temp,{flags:'wx',mode:0o600}));
  const sha=h.digest('hex');if(bytes!==expected||sha!==String(req.get('X-Chunk-SHA256')||''))throw fail(400,'分片校验失败，请重试');
  if(db.prepare('SELECT status FROM uploads WHERE id=?').get(f.id)?.status!=='uploading')throw fail(409,'上传已取消');
  await fsp.rename(temp,file);db.transaction(()=>{db.prepare('INSERT INTO chunks VALUES (?,?,?,?)').run(f.id,idx,bytes,sha);db.prepare('UPDATE uploads SET received=received+? WHERE id=?').run(bytes,f.id);})();res.json({ok:true,idx,sha256:sha});
 }catch(e){await fsp.unlink(temp).catch(()=>{});audit(req,'upload_chunk_failed',f.id,{idx,message:e.message.slice(0,150)});throw e;}finally{locks.delete(key);}
});
app.post(base+'/uploads/:id/complete',auth,async(req,res)=>{
 const f=owned(req,req.params.id);if(f.status==='complete')return res.json(f);if(f.status!=='uploading')throw fail(409,'文件状态不允许完成上传');
 const parts=db.prepare('SELECT idx,size FROM chunks WHERE upload_id=? ORDER BY idx').all(f.id);
 if(parts.length!==Math.ceil(f.size/CHUNK)||parts.reduce((s,p)=>s+p.size,0)!==f.size)throw fail(409,'还有分片未上传完成');
 const key='merge:'+f.id;if(locks.has(key))throw fail(409,'文件正在校验，请稍后刷新');if([...locks].filter(x=>x.startsWith('merge:')).length>=2)throw fail(503,'正在处理其他文件，请稍后重试');locks.add(key);
 const temp=path.join(DATA,'objects',f.id+'.tmp'),final=path.join(DATA,'objects',f.id);let handle;
 try{
  const h=crypto.createHash('sha256');handle=await fsp.open(temp,'w',0o600);
  for(const part of parts){for await(const chunk of fs.createReadStream(path.join(DATA,'chunks',f.id,String(part.idx)))){h.update(chunk);let offset=0;while(offset<chunk.length){const w=await handle.write(chunk,offset,chunk.length-offset);offset+=w.bytesWritten;}}}
  await handle.sync();await handle.close();handle=null;const sha=h.digest('hex');
  if(req.body.sha256&&req.body.sha256!==sha)throw fail(400,'原文件校验不一致，请重新上传');
  if(db.prepare('SELECT status FROM uploads WHERE id=?').get(f.id)?.status!=='uploading')throw fail(409,'上传已取消');
  await fsp.rename(temp,final);db.transaction(()=>{db.prepare("UPDATE uploads SET status='complete',sha256=?,completed=? WHERE id=?").run(sha,now(),f.id);db.prepare('DELETE FROM chunks WHERE upload_id=?').run(f.id);})();
  await fsp.rm(path.join(DATA,'chunks',f.id),{recursive:true,force:true});audit(req,'upload_complete',f.id,{filename:f.filename,size:f.size,sha256:sha});res.json(db.prepare('SELECT * FROM uploads WHERE id=?').get(f.id));
 }catch(e){if(handle)await handle.close().catch(()=>{});await fsp.unlink(temp).catch(()=>{});audit(req,'upload_complete_failed',f.id,{message:e.message.slice(0,150)});throw e;}finally{locks.delete(key);}
});
app.post(base+'/uploads/:id/cancel',auth,async(req,res)=>{const f=owned(req,req.params.id);if(f.status!=='uploading')throw fail(409,'只能取消未完成的上传');if([...locks].some(x=>x.startsWith(f.id+':')||x==='merge:'+f.id))throw fail(409,'请先暂停当前传输再取消');db.transaction(()=>{db.prepare("UPDATE uploads SET status='cancelled' WHERE id=?").run(f.id);db.prepare('DELETE FROM chunks WHERE upload_id=?').run(f.id);})();await fsp.rm(path.join(DATA,'chunks',f.id),{recursive:true,force:true});audit(req,'upload_cancel',f.id);res.json({ok:true});});
function pagination(req){return {limit:Math.min(100,Math.max(1,Number(req.query.limit)||25)),offset:Math.max(0,Number(req.query.offset)||0)};}
function fileWhere(req){let sql="f.status NOT IN ('purged','cancelled')",params=[];const status=String(req.query.status||'');if(status&&['complete','uploading','trash'].includes(status)){sql+=' AND f.status=?';params.push(status);}else if(status!=='all'){sql+=" AND f.status!='trash'";}const q=clean(req.query.q,100);if(q){sql+=' AND (f.filename LIKE ? OR u.name LIKE ? OR f.note LIKE ?)';params.push('%'+q+'%','%'+q+'%','%'+q+'%');}if(['image','video','other'].includes(req.query.category)){sql+=' AND f.category=?';params.push(req.query.category);}return {sql,params};}
app.get(base+'/admin/summary',auth,admin,(req,res)=>{
 const stats=db.prepare("SELECT COUNT(*) attempts,SUM(status='complete') completed,SUM(status='uploading') uploading,SUM(status='trash') trash,COALESCE(SUM(CASE WHEN status='complete' THEN size ELSE 0 END),0) bytes FROM uploads").get();
 const users=db.prepare("SELECT COUNT(*) total,SUM(role='guest') guests FROM users").get();
 const download=db.prepare("SELECT COUNT(*) n FROM audit WHERE event IN ('download','download_zip')").get().n;
 const visits=db.prepare("SELECT COUNT(*) n FROM audit WHERE event='page_view'").get().n;
 const daily=db.prepare("SELECT substr(created,1,10) day,COUNT(*) count FROM uploads WHERE status IN ('complete','trash') AND created>? GROUP BY day ORDER BY day").all(new Date(Date.now()-7*86400000).toISOString());
 res.json({stats,users,downloads:download,visits,storage:storage(),daily,recent:db.prepare('SELECT id,filename,size,status,created FROM uploads ORDER BY created DESC LIMIT 5').all()});
});
app.get(base+'/admin/files',auth,admin,(req,res)=>{const {sql,params}=fileWhere(req),{limit,offset}=pagination(req);res.json({total:db.prepare('SELECT COUNT(*) n FROM uploads f JOIN users u ON u.id=f.user_id WHERE '+sql).get(...params).n,files:db.prepare('SELECT f.*,u.name owner,u.role owner_role FROM uploads f JOIN users u ON u.id=f.user_id WHERE '+sql+' ORDER BY f.created DESC LIMIT ? OFFSET ?').all(...params,limit,offset)});});
app.post(base+'/admin/files/:id/trash',auth,admin,(req,res)=>{const f=owned(req,req.params.id);if(f.status!=='complete')throw fail(409,'只能移入已完成的文件');db.prepare("UPDATE uploads SET status='trash',trashed=? WHERE id=?").run(now(),f.id);audit(req,'file_trash',f.id,{filename:f.filename});res.json({ok:true});});
app.post(base+'/admin/files/:id/restore',auth,admin,(req,res)=>{const f=owned(req,req.params.id);if(f.status!=='trash')throw fail(409,'文件不在回收站');db.prepare("UPDATE uploads SET status='complete',trashed=NULL WHERE id=?").run(f.id);audit(req,'file_restore',f.id);res.json({ok:true});});
app.post(base+'/admin/files/:id/purge',auth,admin,async(req,res)=>{const f=owned(req,req.params.id);if(f.status!=='trash'||req.body.confirm!==f.id)throw fail(400,'需要确认回收站中的文件');await fsp.unlink(path.join(DATA,'objects',f.id)).catch(e=>{if(e.code!=='ENOENT')throw e;});db.prepare("UPDATE uploads SET status='purged' WHERE id=?").run(f.id);audit(req,'file_purge',f.id,{filename:f.filename,size:f.size});res.json({ok:true});});
app.post(base+'/admin/download-tickets',auth,admin,(req,res)=>{limit('ticket:'+req.user.id,60,60000);const ids=[...new Set(Array.isArray(req.body.ids)?req.body.ids:[])];if(!ids.length||ids.length>100)throw fail(400,'每次请选择 1–100 个文件');for(const id of ids){const f=owned(req,id);if(!['complete','trash'].includes(f.status))throw fail(409,'所选文件尚不能下载');}const token=crypto.randomBytes(32).toString('base64url');db.prepare('INSERT INTO tickets VALUES (?,?,?,?,?,0)').run(hash(token),req.user.id,JSON.stringify(ids),ids.length===1?'single':'zip',Date.now()+10*60000);res.json({url:base+'/downloads/'+token});});
app.get(base+'/downloads/:token',(req,res,next)=>{
 const t=db.prepare('SELECT t.* FROM tickets t JOIN users u ON u.id=t.user_id WHERE t.hash=? AND t.expires>? AND u.disabled=0').get(hash(req.params.token),Date.now());if(!t)return next(fail(403,'下载链接已过期，请从管理后台重新下载'));
 const files=JSON.parse(t.ids).map(id=>db.prepare("SELECT * FROM uploads WHERE id=? AND status IN ('complete','trash')").get(id));if(files.some(f=>!f))return next(fail(404,'部分文件已被移除'));
 req.user=db.prepare('SELECT * FROM users WHERE id=?').get(t.user_id);if(!t.used){audit(req,t.kind==='zip'?'download_zip':'download',files.length===1?files[0].id:null,{count:files.length,bytes:files.reduce((a,f)=>a+f.size,0)});db.prepare('UPDATE tickets SET used=1 WHERE hash=?').run(t.hash);}
 if(t.kind==='single'){res.type('application/octet-stream');return res.download(path.join(DATA,'objects',files[0].id),files[0].filename,e=>{if(e&&!res.headersSent)next(e);});}
 res.attachment('素材归档-'+new Date().toISOString().slice(0,10)+'.zip');const zip=new ZipFile();zip.on('error',e=>{if(!res.headersSent)next(e);else res.destroy(e);});zip.outputStream.on('error',e=>res.destroy(e));res.on('close',()=>zip.outputStream.destroy());zip.outputStream.pipe(res);for(const f of files)zip.addFile(path.join(DATA,'objects',f.id),f.id.slice(0,8)+'_'+f.filename,{compress:false});zip.end();
});
function csv(rows,columns){const cell=v=>{let s=String(v??'');if(/^[=+@\-\t\r]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};return '\uFEFF'+[columns.map(x=>cell(x[1])).join(','),...rows.map(r=>columns.map(x=>cell(r[x[0]])).join(','))].join('\r\n');}
app.get(base+'/admin/files.csv',auth,admin,(req,res)=>{const {sql,params}=fileWhere(req);const rows=db.prepare('SELECT f.*,u.name owner FROM uploads f JOIN users u ON u.id=f.user_id WHERE '+sql+' ORDER BY f.created DESC LIMIT 10000').all(...params);audit(req,'export_files',null,{count:rows.length});res.type('text/csv; charset=utf-8').attachment('files.csv').send(csv(rows,[['id','编号'],['filename','文件名'],['owner','提交人'],['size','字节'],['status','状态'],['category','类型'],['note','说明'],['sha256','SHA256'],['created','提交时间'],['completed','完成时间'],['ip','来源IP']]));});
app.get(base+'/admin/logs',auth,admin,(req,res)=>{const {limit,offset}=pagination(req),params=[];let sql='1=1';if(req.query.event){sql+=' AND event=?';params.push(clean(req.query.event,50));}if(req.query.q){sql+=' AND (actor LIKE ? OR ip LIKE ? OR details LIKE ?)';const q='%'+clean(req.query.q,100)+'%';params.push(q,q,q);}res.json({total:db.prepare('SELECT COUNT(*) n FROM audit WHERE '+sql).get(...params).n,logs:db.prepare('SELECT * FROM audit WHERE '+sql+' ORDER BY id DESC LIMIT ? OFFSET ?').all(...params,limit,offset)});});
app.get(base+'/admin/logs.csv',auth,admin,(req,res)=>{const rows=db.prepare('SELECT * FROM audit ORDER BY id DESC LIMIT 10000').all();audit(req,'export_logs',null,{count:rows.length});res.type('text/csv; charset=utf-8').attachment('logs.csv').send(csv(rows,[['id','编号'],['created','时间'],['actor','操作者'],['event','操作'],['file_id','文件编号'],['ip','来源IP'],['details','详情']]));});
app.get(base+'/admin/users',auth,admin,(req,res)=>{const {limit,offset}=pagination(req),q='%'+clean(req.query.q,100)+'%';res.json({total:db.prepare('SELECT COUNT(*) n FROM users WHERE name LIKE ? OR COALESCE(username,\'\') LIKE ?').get(q,q).n,users:db.prepare("SELECT u.id,u.username,u.name,u.role,u.disabled,u.created,(SELECT COUNT(*) FROM uploads f WHERE f.user_id=u.id AND f.status IN ('complete','trash')) uploads,(SELECT COALESCE(SUM(size),0) FROM uploads f WHERE f.user_id=u.id AND f.status IN ('complete','trash')) bytes FROM users u WHERE name LIKE ? OR COALESCE(username,'') LIKE ? ORDER BY created DESC LIMIT ? OFFSET ?").all(q,q,limit,offset)});});
app.post(base+'/admin/users/:id/toggle',auth,admin,(req,res)=>{if(req.params.id===req.user.id)throw fail(400,'不能停用当前管理员');const u=db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);if(!u||u.role==='admin')throw fail(400,'不能修改此账号');db.transaction(()=>{db.prepare('UPDATE users SET disabled=? WHERE id=?').run(u.disabled?0:1,u.id);if(!u.disabled)db.prepare('DELETE FROM sessions WHERE user_id=?').run(u.id);})();audit(req,u.disabled?'user_enable':'user_disable',null,{id:u.id,name:u.name});res.json({ok:true});});
app.get(base+'/admin/settings',auth,admin,(req,res)=>res.json({...cfg(),storage:storage()}));
app.patch(base+'/admin/settings',auth,admin,(req,res)=>{const v=req.body,changes={};for(const k of ['open','guests','registration'])if(typeof v[k]==='boolean')changes[k]=v[k];if(v.title!==undefined)changes.title=clean(v.title,60)||'素材征集';if(v.notice!==undefined)changes.notice=clean(v.notice,2000);if(v.maxFileMB!==undefined){if(!Number.isInteger(v.maxFileMB)||v.maxFileMB<1||v.maxFileMB>2048)throw fail(400,'单文件限制需为 1–2048 MB');changes.maxFileMB=v.maxFileMB;}if(v.quotaGB!==undefined){if(!Number.isFinite(v.quotaGB)||v.quotaGB<0.1||v.quotaGB>1000)throw fail(400,'存储额度无效');const s=storage();if(v.quotaGB*1024**3>s.used+s.free-3*1024**3)throw fail(400,'额度过大，请至少保留 3GB 磁盘空间');changes.quotaGB=v.quotaGB;}db.transaction(()=>{for(const [k,value]of Object.entries(changes))db.prepare('UPDATE settings SET value=? WHERE key=?').run(JSON.stringify(value),k);})();audit(req,'settings_update',null,changes);res.json(cfg());});
require('./scifi.cjs')({app,base,db,auth,admin,now,clean,fail,audit,cfg,limit,DATA});
// A disposable in-memory benchmark: authenticated, bounded, and no user files saved.
app.post(base+'/speedtest',auth,async(req,res)=>{limit('speed:'+req.user.id,6,3600000);const size=Number(req.get('Content-Length'));if(!Number.isInteger(size)||size<1||size>16*1024**2)throw fail(413,'测速数据最多 16MB');let n=0;const h=crypto.createHash('sha256'),start=process.hrtime.bigint();for await(const chunk of req){n+=chunk.length;if(n>size)throw fail(413,'数据超过限制');h.update(chunk);}const seconds=Number(process.hrtime.bigint()-start)/1e9;audit(req,'speed_test',null,{bytes:n,seconds});res.json({bytes:n,sha256:h.digest('hex'),serverSeconds:seconds});});
app.use((req,res)=>res.status(404).json({error:'接口不存在'}));
app.use((err,req,res,next)=>{if(res.headersSent)return res.destroy();const status=err.status||500;if(status>=500)console.error(now(),req.method,req.path,err.stack);res.status(status).json({error:status>=500&&status!==507?'服务暂时繁忙，请稍后重试':err.message});});
const timer=setInterval(()=>{try{db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now());db.prepare('DELETE FROM tickets WHERE expires<?').run(Date.now());for(const [key,r]of rates)if(r.until<Date.now())rates.delete(key);const stale=db.prepare("SELECT id FROM uploads WHERE status='uploading' AND created<?").all(new Date(Date.now()-48*3600000).toISOString());for(const {id}of stale){if([...locks].some(x=>x.startsWith(id+':')||x==='merge:'+id))continue;db.transaction(()=>{db.prepare("UPDATE uploads SET status='cancelled' WHERE id=?").run(id);db.prepare('DELETE FROM chunks WHERE upload_id=?').run(id);})();fs.rmSync(path.join(DATA,'chunks',id),{recursive:true,force:true});}db.prepare('DELETE FROM audit WHERE created<?').run(new Date(Date.now()-180*86400000).toISOString());}catch(e){console.error('maintenance',e.message);}},3600000);timer.unref();
const server=app.listen(Number(process.env.PORT)||18877,'127.0.0.1',()=>console.log('SJ collection ready',server.address().port));server.requestTimeout=180000;server.headersTimeout=30000;server.keepAliveTimeout=10000;
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{server.close(()=>{db.close();process.exit(0);});setTimeout(()=>process.exit(1),15000).unref();});
module.exports={app,server,db};
