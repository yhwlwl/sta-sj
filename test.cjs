'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),{spawn,execFileSync}=require('node:child_process');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sj-test-')),port=18878,base='http://127.0.0.1:'+port+'/sj-api/v1';
const child=spawn(process.execPath,['server.cjs'],{cwd:__dirname,env:{...process.env,PORT:String(port),SJ_DATA:dir},stdio:['ignore','pipe','pipe']});let errors='';child.stderr.on('data',b=>errors+=b);let passed=0;
function sha(b){return crypto.createHash('sha256').update(b).digest('hex');}
async function call(route,method='GET',body,token,status=200){const r=await fetch(base+route,{method,headers:{...(body!==undefined?{'Content-Type':'application/json'}:{}),...(token?{Authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body)});const d=await r.json();assert.equal(r.status,status,JSON.stringify(d));passed++;return d;}
async function chunk(id,idx,data,token,status=200,checksum=sha(data)){const r=await fetch(base+'/uploads/'+id+'/chunks/'+idx,{method:'PUT',headers:{Authorization:'Bearer '+token,'Content-Type':'application/octet-stream','X-Chunk-SHA256':checksum},body:data});const d=await r.json();assert.equal(r.status,status,JSON.stringify(d));passed++;return d;}
(async()=>{try{
 for(let i=0;i<100;i++){try{await fetch(base+'/health');break;}catch{await new Promise(r=>setTimeout(r,100));}}
 await call('/health');const m=await call('/meta');assert.equal(m.setupRequired,true);
 await call('/admin/summary','GET',undefined,undefined,401);
 const bootstrap=fs.readFileSync(path.join(dir,'setup-token'),'utf8');await call('/auth/setup','POST',{token:'wrong',username:'admin',password:'test-password-123'},undefined,403);
 let a=await call('/auth/setup','POST',{token:bootstrap,username:'admin',name:'测试管理员',password:'test-password-123'});assert.equal(a.user.role,'admin');assert.equal(fs.existsSync(path.join(dir,'setup-token')),false);
 await call('/auth/setup','POST',{token:bootstrap,username:'evil',password:'test-password-123'},undefined,409);
 await call('/auth/login','POST',{username:'admin',password:'wrong'},undefined,401);
 let u=await call('/auth/register','POST',{username:'tester',name:'测试投稿者',password:'test-user-password'});
 await call('/auth/register','POST',{username:'tester',name:'重复账号',password:'test-user-password'},undefined,409);
 const g=await call('/auth/guest','POST',{name:'测试游客'}),other=await call('/auth/guest','POST',{name:'其他游客'});
 await call('/admin/files','GET',undefined,g.token,403);
 const cors=await fetch(base+'/meta',{headers:{Origin:'https://untrusted.example'}});assert.equal(cors.status,403);passed++;
 const preflight=await fetch(base+'/meta',{method:'OPTIONS',headers:{Origin:'https://sj.stacdqz.tech'}});assert.equal(preflight.status,204);assert.equal(preflight.headers.get('access-control-allow-origin'),'https://sj.stacdqz.tech');passed++;
 const payload=crypto.randomBytes(9*1024*1024+37),first=await call('/uploads','POST',{filename:'测试视频.mov',mime:'video/quicktime',size:payload.length,category:'video',note:'完整性和断点重试测试'},g.token,201);
 await call('/uploads/'+first.id,'GET',undefined,other.token,404);
 await chunk(first.id,0,payload.subarray(0,m.chunkSize),g.token,400,'bad-hash');
 await chunk(first.id,0,payload.subarray(0,m.chunkSize),g.token);
 const repeat=await chunk(first.id,0,payload.subarray(0,m.chunkSize),g.token);assert.equal(repeat.already,true);
 let state=await call('/uploads/'+first.id,'GET',undefined,g.token);assert.equal(state.chunks.length,1);
 await call('/uploads/'+first.id+'/complete','POST',{},g.token,409);
 await chunk(first.id,1,payload.subarray(m.chunkSize),g.token);
 let done=await call('/uploads/'+first.id+'/complete','POST',{sha256:sha(payload)},g.token);assert.equal(done.sha256,sha(payload));assert.equal(done.status,'complete');assert.deepEqual(fs.readFileSync(path.join(dir,'objects',first.id)),payload);passed++;
 await call('/uploads/'+first.id+'/complete','POST',{},g.token);
 const tiny=Buffer.from('原始文件保持不变\n'),second=await call('/uploads','POST',{filename:'说明.txt',size:tiny.length,category:'other'},u.token,201);await chunk(second.id,0,tiny,u.token);await call('/uploads/'+second.id+'/complete','POST',{sha256:sha(tiny)},u.token);
 const own=await call('/uploads','GET',undefined,g.token);assert.equal(own.files.length,1);
 let ticket=await call('/admin/download-tickets','POST',{ids:[first.id]},a.token);let r=await fetch('http://127.0.0.1:'+port+ticket.url);assert.equal(r.status,200);assert.equal(r.headers.get('content-type'),'application/octet-stream');assert.deepEqual(Buffer.from(await r.arrayBuffer()),payload);passed++;
 await call('/downloads/invalid','GET',undefined,undefined,403);
 ticket=await call('/admin/download-tickets','POST',{ids:[first.id,second.id]},a.token);r=await fetch('http://127.0.0.1:'+port+ticket.url);const zip=Buffer.from(await r.arrayBuffer());assert.equal(r.status,200);const zipPath=path.join(dir,'check.zip');fs.writeFileSync(zipPath,zip);
 const z=JSON.parse(execFileSync('python3',['-c','import zipfile,json,hashlib,sys;z=zipfile.ZipFile(sys.argv[1]);print(json.dumps([hashlib.sha256(z.read(n)).hexdigest() for n in z.namelist()]))',zipPath],{encoding:'utf8'}));assert.deepEqual(z.sort(),[sha(payload),sha(tiny)].sort());passed++;
 let summary=await call('/admin/summary','GET',undefined,a.token);assert.equal(summary.stats.completed,2);assert.equal(summary.downloads,2);
 const csv=await fetch(base+'/admin/files.csv',{headers:{Authorization:'Bearer '+a.token}});assert.equal(csv.status,200);assert.match(await csv.text(),/测试视频.mov/);passed++;
 await call('/admin/files/'+first.id+'/trash','POST',{},a.token);await call('/admin/files/'+first.id+'/restore','POST',{},a.token);
 await call('/admin/files/'+first.id+'/purge','POST',{confirm:first.id},a.token,400);
 await call('/admin/settings','PATCH',{open:false},a.token);await call('/uploads','POST',{filename:'blocked.txt',size:1},g.token,403);await call('/admin/settings','PATCH',{open:true,guests:false},a.token);await call('/auth/guest','POST',{name:'blocked'},undefined,403);await call('/admin/settings','PATCH',{guests:true},a.token);
 await call('/admin/settings','PATCH',{maxFileMB:0},a.token,400);await call('/admin/settings','PATCH',{quotaGB:1000},a.token,400);
 const cancel=await call('/uploads','POST',{filename:'cancel.txt',size:1},g.token,201);await call('/uploads/'+cancel.id+'/cancel','POST',{},g.token);assert.equal(fs.existsSync(path.join(dir,'chunks',cancel.id)),false);
 await call('/admin/users/'+other.user.id+'/toggle','POST',{},a.token);await call('/me','GET',undefined,other.token,401);
 await call('/events','POST',{event:'page_view',page:'upload'},g.token);
 let logs=await call('/admin/logs','GET',undefined,a.token);assert(logs.logs.some(x=>x.event==='file_trash'));assert(logs.logs.some(x=>x.event==='download_zip'));
 await call('/admin/files/'+first.id+'/trash','POST',{},a.token);await call('/admin/files/'+first.id+'/purge','POST',{confirm:first.id},a.token);assert.equal(fs.existsSync(path.join(dir,'objects',first.id)),false);
 const old=a.token;a=await call('/auth/password','POST',{currentPassword:'test-password-123',password:'new-password-456'},a.token);await call('/me','GET',undefined,old,401);await call('/auth/login','POST',{username:'admin',password:'new-password-456'});
 await call('/auth/logout','POST',{},g.token);await call('/me','GET',undefined,g.token,401);
 console.log(JSON.stringify({ok:true,checks:passed,tests:['setup','password hashing and rotation','guest and user authentication','cross-user access isolation','CORS','chunk integrity','retry and resume','file assembly SHA256','single download','streamed ZIP archive','CSV export','quotas','collection controls','soft deletion and restoration','permanent deletion','disabled accounts','audit logging']}));
 }catch(e){console.error(e.stack);console.error(errors);process.exitCode=1;}finally{child.kill('SIGTERM');await new Promise(resolve=>child.once('exit',resolve));fs.rmSync(dir,{recursive:true,force:true});}})();
