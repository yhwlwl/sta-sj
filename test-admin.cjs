'use strict';
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawn}=require('node:child_process');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sj-admin-test-'));
const port=19093,base='http://127.0.0.1:'+port+'/sj-api/v1';
let child,checks=0,log='';
const password=()=>crypto.randomBytes(24).toString('base64url');
async function start(){
 child=spawn(process.execPath,['server.cjs'],{cwd:__dirname,env:{...process.env,PORT:String(port),SJ_DATA:dir},stdio:['ignore','ignore','pipe']});
 child.stderr.on('data',b=>log+=b);
 let ok=false;
 for(let i=0;i<100;i++){
  try{const r=await fetch(base+'/health');if(r.ok){ok=true;break;}}catch{}
  await new Promise(r=>setTimeout(r,100));
 }
 if(!ok)throw new Error('Test server did not start: '+log);
}
async function stop(){
 if(!child)return;
 const proc=child;child=null;
 const ended=new Promise(resolve=>proc.once('exit',resolve));
 proc.kill('SIGTERM');
 await ended;
}
async function request(route,method='GET',body,token,status=200){
 const r=await fetch(base+route,{method,headers:{...(body===undefined?{}:{'Content-Type':'application/json'}),...(token?{Authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body)});
 const data=await r.json();
 assert.equal(r.status,status,route+': '+JSON.stringify(data));
 checks++;
 return data;
}
(async()=>{
 try{
  await start();
  const originalPassword=password();
  const setupToken=fs.readFileSync(path.join(dir,'setup-token'),'utf8');
  const original=await request('/auth/setup','POST',{token:setupToken,username:'tle',name:'测试负责人',password:originalPassword});
  assert.equal(original.user.isSuperadmin,false);checks++;
  await request('/admin/super/admins','GET',undefined,original.token,403);
  await stop();
  // Existing administrator is promoted on subsequent server startup, not by re-registering.
  await start();
  const login=await request('/auth/login','POST',{username:'tle',password:originalPassword});
  assert.equal(login.user.isSuperadmin,true);checks++;
  const list=await request('/admin/super/admins','GET',undefined,login.token);
  assert.equal(list.admins.length,1);
  assert.equal(list.admins[0].username,'tle');
  assert.equal(list.admins[0].isSuperadmin,true);
  checks++;
  await request('/admin/super/admins','POST',{username:'wkx',name:'普通管理员',password:'short'},login.token,400);
  const initialPassword=password();
  const created=await request('/admin/super/admins','POST',{username:'wkx',name:'普通管理员',password:initialPassword},login.token,201);
  assert.equal(created.admin.isSuperadmin,false);
  assert(!JSON.stringify(created).includes(initialPassword));checks++;
  await request('/admin/super/admins','POST',{username:'wkx',name:'同名账号',password:password()},login.token,409);
  const normal=await request('/auth/login','POST',{username:'wkx',password:initialPassword});
  assert.equal(normal.user.role,'admin');
  assert.equal(normal.user.isSuperadmin,false);checks++;
  await request('/admin/summary','GET',undefined,normal.token,200);
  await request('/admin/super/admins','GET',undefined,normal.token,403);
  await request('/admin/super/admins','POST',{username:'next',name:'无权限',password:password()},normal.token,403);
  await request('/admin/users/'+created.admin.id+'/toggle','POST',{},login.token,400);
  const newPassword=password();
  await request('/auth/password','POST',{currentPassword:initialPassword,password:newPassword},normal.token);
  await request('/me','GET',undefined,normal.token,401);
  await request('/auth/login','POST',{username:'wkx',password:initialPassword},undefined,401);
  const updated=await request('/auth/login','POST',{username:'wkx',password:newPassword});
  assert.equal(updated.user.isSuperadmin,false);checks++;
  const two=await request('/admin/super/admins','GET',undefined,login.token);
  assert.equal(two.admins.length,2);checks++;
  console.log(JSON.stringify({ok:true,checks,tests:['existing tle promotion','superadmin-only list and creation','weak and duplicate password checks','ordinary admin isolation','ordinary admin self-service password change']}));
 }catch(err){console.error(err.stack,log);process.exitCode=1;}
 finally{await stop();fs.rmSync(dir,{recursive:true,force:true});}
})();
