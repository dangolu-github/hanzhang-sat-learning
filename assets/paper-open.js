(function(){
 'use strict';const script=document.currentScript,id=script.dataset.resource,kind=script.dataset.portal,endpoint=script.dataset.endpoint;
 const button=document.createElement('button');button.type='button';button.textContent='Edit annotations';button.style.cssText='position:fixed;right:18px;bottom:18px;z-index:2147483000;background:#285d48;color:white;border:1px solid #c9d9c9;border-radius:24px;padding:12px 18px;font:14px system-ui;cursor:pointer';button.className='paper-open-button';
 const style=document.createElement('style');style.textContent='@media print{.paper-open-button{display:none!important}}';document.head.append(style);document.body.append(button);
 button.onclick=async()=>{button.disabled=true;button.textContent='Opening annotations…';try{
  let result;
  if(kind==='hanzhang'){await HanzhangAccess.ready;result=await HanzhangAccess.post('createPaperAnnotationLink',{resourceId:id});}
  else if(kind==='rachel'){const token=await new Promise(resolve=>RachelAccess.whenTrusted(resolve));const r=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({action:'createPaperAnnotationLink',resourceId:id,accessToken:token})});result=await r.json();}
  else if(kind==='emily'){if(window.EmilyAPI)result=await EmilyAPI.call('createPaperAnnotationLink',{resourceId:id});else{const token=localStorage.getItem('emily-ssat-session-v1');if(!token)throw Error('Open your portal home and sign in, then return to this handout.');const r=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({action:'createPaperAnnotationLink',resourceId:id,token})});result=await r.json();}}
  if(!result?.ok||!result.url)throw Error(result?.error||'Please sign in to open annotations.');location.assign(result.url);
 }catch(error){button.disabled=false;button.textContent='Edit annotations';let message=document.getElementById('paper-open-error');if(!message){message=document.createElement('p');message.id='paper-open-error';message.setAttribute('role','alert');button.before(message);}message.textContent=error.message;}};
})();
