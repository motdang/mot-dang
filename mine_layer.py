"""mine_layer.py — a reader's saved places, lit on every map and named first.

Michael, 2026-09-29, through Nan: the maps should highlight the places he has
pinned or saved, show those by name while the map is still zoomed out, and show
more names of other things the further in he goes.

Two halves:
  MD_JS  rides at the end of md.js (every page). MDSAVED keeps the list in this
         browser as localStorage md-saved: plan stops (md-plan), bookmarks on
         my.html that point at a place page (md-bm), and pins dropped on
         /map.html. A plan stop stays saved after it leaves the plan — the plan
         is a day out, the save is the history.
  MAP_JS rides at the end of map.js. map_shell calls MDMINE.paint() when a map
         loads: a marigold ring and the name, from the widest zoom in, on top of
         every layer added after it. The other names are explore.js's job
         (rank decides the zoom a name appears at).
"""

MD_JS = r"""/* mine_layer.py — saved places, kept in this browser (md-saved). */
(function(){
var KEY='md-saved',MAX=500,KRE=/^[a-z]{2}:[a-z0-9-]+$/;
function get(){try{var v=JSON.parse(localStorage.getItem(KEY));return Array.isArray(v)?v:[];}catch(e){return[];}}
function put(a){try{localStorage.setItem(KEY,JSON.stringify(a.slice(-MAX)));}catch(e){}
  try{document.dispatchEvent(new CustomEvent('md-saved'));}catch(e){}}
function same(a,b){return a.k||b.k?a.k===b.k:
  Math.abs(a.lat-b.lat)<2e-5&&Math.abs(a.lng-b.lng)<2e-5;}
function ok(o){return o&&(o.k?KRE.test(o.k):isFinite(o.lat)&&isFinite(o.lng));}
function merge(a,o){
  for(var i=0;i<a.length;i++)if(same(a[i],o)){var ch=false;
    for(var p in o)if(o[p]!=null&&o[p]!==''&&a[i][p]!==o[p]){a[i][p]=o[p];ch=true;}
    return ch;}
  o.t=Date.now();a.push(o);return true;}
function add(list){var a=get(),ch=false;
  (Array.isArray(list)?list:[list]).forEach(function(o){if(ok(o)&&merge(a,o))ch=true;});
  if(ch)put(a);}
function has(o){return get().some(function(x){return same(x,o);});}
function forget(o){var a=get(),b=a.filter(function(x){return !same(x,o);});if(b.length!==a.length)put(b);
  /* a dated note of the removal, so a reader signed in on another device does not get it back (accounts_layer.py) */
  try{var g=JSON.parse(localStorage.getItem('md-saved-gone'))||[];
    g.push(o.k?{k:o.k,t:Date.now()}:{lat:+o.lat,lng:+o.lng,t:Date.now()});
    localStorage.setItem('md-saved-gone',JSON.stringify(g.slice(-500)));}catch(e){}}
function keys(list){add((list||[]).filter(function(k){return typeof k==='string';})
  .map(function(k){return {k:k};}));}
window.MDSAVED={get:get,add:add,has:has,forget:forget,keys:keys};
/* What this browser already holds: the plan, and bookmarks to place pages. */
try{keys(JSON.parse(localStorage.getItem('md-plan'))||[]);}catch(e){}
try{add((JSON.parse(localStorage.getItem('md-bm'))||[]).map(function(b){
  var m=/(?:^|\/)([a-z]{2})\/p\/([a-z0-9-]+)\.html/.exec(b&&b.u||'');
  return m?{k:m[1]+':'+m[2],n:(b.n||'').slice(0,60)}:null;}).filter(Boolean));}catch(e){}
})();
"""

MAP_JS = r"""/* mine_layer.py — saved places on every map: a marigold ring and the name
   from the widest view in, above every layer added after it. */
(function(){
var CFG=window.MDMAP_CFG||{},FONT=['NotoSans'];
(CFG.layers||[]).some(function(l){
  if(l.type==='symbol'&&l.layout&&l.layout['text-font']){FONT=l.layout['text-font'];return true;}});
function root(){return document.documentElement.getAttribute('data-root')||'';}
function list(){return window.MDSAVED?MDSAVED.get():[];}
function label(x){
  if(x.nt&&x.ne&&x.nt!==x.ne)return x.nt+'\n'+x.ne;
  return x.nt||x.ne||x.n||'หมุดของฉัน · my pin';}
/* skip: a map drawn around one place (a place page) already names it. */
function gj(skip){
  var out=[];
  list().forEach(function(x,i){
    if(!isFinite(x.lat)||!isFinite(x.lng))return;
    if(skip&&Math.abs(x.lat-skip[0])<3e-4&&Math.abs(x.lng-skip[1])<3e-4)return;
    out.push({type:'Feature',geometry:{type:'Point',coordinates:[+x.lng,+x.lat]},
      properties:{i:i,k:x.k||'',label:label(x)}});});
  return {type:'FeatureCollection',features:out};}
/* A plan key carries no position: read it off the place's own record, once
   per page, and keep it with the save. */
var asked={};
function resolve(){
  list().forEach(function(x){
    if(!x.k||isFinite(x.lat)||asked[x.k])return;
    asked[x.k]=1;
    var p=x.k.split(':');
    fetch(root()+p[0]+'/p/'+p[1]+'.json').then(function(r){if(!r.ok)throw 0;return r.json();})
      .then(function(d){if(typeof d.lat!=='number'||typeof d.lng!=='number')return;
        MDSAVED.add({k:x.k,lat:d.lat,lng:d.lng,nt:d.nameTh||'',ne:d.nameEn||(d.nameTh?'':d.name||'')});})
      .catch(function(){});});}
function item(x){
  if(x.k){var p=x.k.split(':');
    return {name:label(x).replace('\n',' · '),
      sub:p[0]==='cr'?'เชียงราย · Chiang Rai':'เชียงใหม่ · Chiang Mai',
      href:root()+p[0]+'/p/'+p[1]+'.html',json:root()+p[0]+'/p/'+p[1]+'.json',
      plan:x.k,lat:+x.lat,lng:+x.lng};}
  return {name:label(x),sub:'หมุดของฉัน · my pin',lat:+x.lat,lng:+x.lng,
    href:root()+'map.html#17/'+(+x.lat).toFixed(5)+'/'+(+x.lng).toFixed(5)};}
var IDS=['md-mine-ring','md-mine-name'];
function paint(map,el){
  if(!window.MDSAVED||map.getSource('md-mine'))return;
  var skip=el.id!=='xmap'&&el.querySelector('.mdmap-draw')&&isFinite(parseFloat(el.dataset.lat))?
    [parseFloat(el.dataset.lat),parseFloat(el.dataset.lng)]:null;
  map.addSource('md-mine',{type:'geojson',data:gj(skip)});
  map.addLayer({id:'md-mine-ring',type:'circle',source:'md-mine',paint:{
    'circle-radius':['interpolate',['linear'],['zoom'],9,5,14,8,17,11],
    'circle-color':'#F4B400','circle-stroke-color':'#17110C','circle-stroke-width':2}});
  if(CFG.glyphs)map.addLayer({id:'md-mine-name',type:'symbol',source:'md-mine',layout:{
    'text-field':['get','label'],'text-font':FONT,'text-size':14,'text-max-width':10,
    'text-variable-anchor':['left','right','top','bottom'],'text-radial-offset':1,
    'text-justify':'auto'},
    paint:{'text-color':'#17110C','text-halo-color':'#FFF3C4','text-halo-width':2.2}});
  /* Anything added later (a shelf, search results) goes in under these, so a
     saved place is never painted over and its name wins every collision. */
  var add=map.addLayer.bind(map);
  map.addLayer=function(ly,before){
    if(!before&&ly&&IDS.indexOf(ly.id)<0&&map.getLayer(IDS[0]))before=IDS[0];
    return add(ly,before);};
  function redo(){var s=map.getSource('md-mine');if(s)s.setData(gj(skip));}
  document.addEventListener('md-saved',redo);
  addEventListener('storage',function(e){if(e.key==='md-saved')redo();});
  map.on('click',function(e){
    var R=18,pt=e.point,ids=IDS.filter(function(id){return map.getLayer(id);});
    var f=map.queryRenderedFeatures([[pt.x-R,pt.y-R],[pt.x+R,pt.y+R]],{layers:ids});
    if(!f.length)return;
    var x=list()[f[0].properties.i];if(!x)return;
    var it=item(x);
    if(window.MDX&&MDX.el===el){
      if(x.k)MDX.openItem(it);
      else if(window.MDMAPSHEET&&MDMAPSHEET.point)MDMAPSHEET.point(it.lat,it.lng,it.name);
      return;}
    if(window.MDCARD)window.MDCARD.show(it,el);
  });
  resolve();
}
/* explore.js asks this before answering a tap, so one touch opens one sheet. */
function hit(map,pt){
  var ids=IDS.filter(function(id){return map.getLayer(id);});
  if(!ids.length)return false;
  var R=18;
  return map.queryRenderedFeatures([[pt.x-R,pt.y-R],[pt.x+R,pt.y+R]],{layers:ids}).length>0;}
window.MDMINE={paint:paint,hit:hit};
})();
"""


def md_js():
    return MD_JS


def map_js():
    return MAP_JS
