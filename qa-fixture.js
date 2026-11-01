// Temporary browser QA page only. Not included in the production build.
const qaBox=document.createElement('aside');
qaBox.style.cssText='position:fixed;bottom:12px;left:12px;background:white;border:1px solid #ddd;padding:12px;z-index:100;max-width:500px;font-size:11px;word-break:break-all';
const qaButton=document.createElement('button');qaButton.textContent='生成验收文件（9MB）';qaButton.className='btn secondary tiny';
const qaInfo=document.createElement('p');qaInfo.id='qa-fixture-hash';qaBox.append(qaButton,qaInfo);document.body.append(qaBox);
qaButton.addEventListener('click',async()=>{
 if(!document.querySelector('#file-picker')){qaInfo.textContent='请先以游客身份进入投稿页面';return;}
 const data=new Uint8Array(9*1024*1024+37);for(let i=0;i<data.length;i+=65536)crypto.getRandomValues(data.subarray(i,Math.min(i+65536,data.length)));
 const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data))).map(x=>x.toString(16).padStart(2,'0')).join('');
 qaInfo.textContent='原件 SHA-256：'+digest;
 addFiles([new File([data],'sj-browser-fixture.bin',{type:'application/octet-stream',lastModified:1700000000000})]);
 qaButton.disabled=true;
});
