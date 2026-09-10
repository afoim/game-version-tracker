from __future__ import annotations
import datetime as dt, html, json, re, urllib.parse, urllib.request
API="https://bbs-api-os.hoyolab.com/community/post/wapi"; GAME_ID=8; UTC8=dt.timezone(dt.timedelta(hours=8))
VERSION_RE=re.compile(r"(?:Version|V)\s*(\d+\.\d+)",re.I)
DATE_RE=re.compile(r"(20\d{2}/\d{2}/\d{2})\s+(\d{2}:\d{2})\s*\(UTC\+8\)",re.I)
def _get(url):
 req=urllib.request.Request(url,headers={"User-Agent":"Mozilla/5.0 game-version-tracker/0.1"})
 with urllib.request.urlopen(req,timeout=20) as r:return json.load(r)
def _text(s):return html.unescape(re.sub(r"<[^>]+>","",re.sub(r"<br\s*/?>","\n",s,flags=re.I)))
class ZZZAdapter:
 slug="zzz"; name="绝区零"
 def _news(self,t,n=100):
  q=urllib.parse.urlencode({"gids":GAME_ID,"type":t,"page_size":n});return _get(f"{API}/getNewsList?{q}")["data"]["list"]
 def _post(self,pid):return _get(f"{API}/getPostFull?post_id={pid}")["data"]["post"]["post"]
 def collect(self):
  candidates=[]
  for item in self._news(1):
   p=item.get("post",{}); title=p.get("subject",""); m=VERSION_RE.search(title)
   if m and ("Update Announcement" in title or "Pre-Download & Update Notice" in title):candidates.append((tuple(map(int,m.group(1).split("."))),p))
  if not candidates:raise RuntimeError("No ZZZ update announcement found")
  vt,meta=max(candidates,key=lambda x:x[0]); version=".".join(map(str,vt)); text=_text(self._post(str(meta['post_id'])).get('content','')); dm=DATE_RE.search(text)
  start=dt.datetime.strptime(" ".join(dm.groups()),"%Y/%m/%d %H:%M").replace(tzinfo=UTC8)+dt.timedelta(hours=5) if dm else dt.datetime.fromtimestamp(meta['created_at'],UTC8)
  nv=f"{vt[0]}.{vt[1]+1}"; expected=start+dt.timedelta(days=42); now=dt.datetime.now(UTC8)
  preview=None
  for t in (3,1):
   for item in self._news(t):
    p=item.get('post',{}); title=p.get('subject','')
    if nv in title and 'Special Program' in title:preview=p;break
   if preview:break
  return {'game':self.slug,'name':self.name,'collected_at':dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds'),'current':{'version':version,'start_at':start.isoformat()},'next':{'version':nv,'expected_start_at':expected.isoformat(),'confirmed':False,'days_remaining':max(0,(expected.date()-now.date()).days)},'preview':{'announced':bool(preview),'title':preview.get('subject') if preview else None,'post_id':str(preview.get('post_id')) if preview else None}}
