(function(){
  "use strict";
  const store=window.ESPANStore;
  if(!store || !("Notification" in window)) return;
  let known=new Set((store.data.notifications||[]).map(n=>n.id));

  async function askOnce(){
    if(Notification.permission!=="default") return;
    try{ await Notification.requestPermission(); }catch(_){ }
  }

  // المتصفح يشترط تفاعلًا من المستخدم قبل طلب الإذن؛ لا نظهر زرًا أو حالة داخل الصفحة.
  const firstInteraction=()=>{
    document.removeEventListener("pointerdown",firstInteraction,true);
    document.removeEventListener("keydown",firstInteraction,true);
    askOnce();
  };
  document.addEventListener("pointerdown",firstInteraction,true);
  document.addEventListener("keydown",firstInteraction,true);

  function showNew(){
    const list=(store.data.notifications||[]);
    for(const n of list){
      if(known.has(n.id)) continue;
      known.add(n.id);
      if(Notification.permission==="granted"){
        try{ new Notification(n.title||"ESPAN",{body:n.message||"لديك تحديث جديد",icon:"Images/ESPAN-logo-transparent.png"}); }catch(_){ }
      }
    }
  }

  setInterval(async()=>{
    try{ await store.refreshAsync(); showNew(); }catch(_){ }
  },12000);
})();
