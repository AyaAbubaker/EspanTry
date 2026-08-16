self.addEventListener("push",event=>{
  let payload={};
  try{payload=event.data?event.data.json():{};}catch(_){payload={body:event.data?event.data.text():""};}
  const title=payload.title||"ESPAN";
  const options={
    body:payload.body||"لديك تحديث جديد من ESPAN",
    icon:"/Images/ESPAN-logo-transparent.png",
    badge:"/Images/ESPAN-logo-transparent.png",
    dir:"rtl",
    lang:"ar",
    data:{url:payload.url||"/"},
    tag:payload.tag||undefined,
    renotify:false
  };
  event.waitUntil(self.registration.showNotification(title,options));
});
self.addEventListener("notificationclick",event=>{
  event.notification.close();
  const target=new URL(event.notification.data?.url||"/",self.location.origin).href;
  event.waitUntil(clients.matchAll({type:"window",includeUncontrolled:true}).then(list=>{
    for(const client of list){if(client.url===target&&"focus" in client)return client.focus();}
    return clients.openWindow?clients.openWindow(target):undefined;
  }));
});
