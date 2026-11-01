import hashlib,json,os,subprocess,tempfile,time
from pathlib import Path
base=os.environ.get('SJ_PROBE_URL')
if not base:
 raise SystemExit('Set SJ_PROBE_URL to a controlled authorized upload-test endpoint')
root=Path(__file__).parent
results=[]
with tempfile.TemporaryDirectory() as tmp:
 for mib in [1,8,32]:
  payload=os.urandom(mib*1024*1024)
  path=Path(tmp)/'payload.bin';path.write_bytes(payload)
  expected=hashlib.sha256(payload).hexdigest()
  for attempt in range(1,4):
   out=Path(tmp)/'response.json'
   cmd=['curl','-sS','--connect-timeout','10','--max-time','100','-H','Content-Type: application/octet-stream','-H','Expect:','--data-binary','@'+str(path),'-o',str(out),'-w','%{http_code} %{time_total} %{speed_upload} %{size_upload}',base+'upload']
   start=time.monotonic();p=subprocess.run(cmd,capture_output=True,text=True)
   try:body=json.loads(out.read_text())
   except Exception:body={}
   row={'mib':mib,'attempt':attempt,'curl':p.stdout.strip(),'exit':p.returncode,'wall_seconds':round(time.monotonic()-start,3),'body':body,'integrity_ok':body.get('sha256')==expected,'error':p.stderr[:250]}
   results.append(row);print(json.dumps(row),flush=True)
   (root/'speedtest-results.json').write_text(json.dumps({'source':'managed cloud environment through configured proxy; not a mainland residential network','target':'Aliyun cn-chengdu HTTPS ingress','results':results},ensure_ascii=False,indent=2))
   if p.returncode:break
