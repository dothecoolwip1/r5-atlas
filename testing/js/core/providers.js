/* R5 Atlas network provider boundary. */
(function(root){
  'use strict';
  async function fetchJson(url,timeout=18000,options={}){
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),timeout);
    try{
      const response=await fetch(url,{...options,signal:controller.signal});
      if(!response.ok)throw Error(`HTTP ${response.status}`);
      const data=await response.json();
      if(data&&data.error)throw Error(data.error.message||'Service error');
      return data;
    }finally{
      clearTimeout(timer);
    }
  }
  root.R5Providers=Object.freeze({fetchJson});
})(globalThis);
