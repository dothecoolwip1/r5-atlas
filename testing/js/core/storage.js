/* R5 Atlas browser storage adapter. */
(function(root){
  'use strict';
  const backend=()=>root.localStorage;
  const api={
    getItem(key){return backend().getItem(key)},
    setItem(key,value){backend().setItem(key,String(value))},
    removeItem(key){backend().removeItem(key)},
    getJson(key,fallback){
      const raw=api.getItem(key);
      if(raw==null)return fallback;
      try{return JSON.parse(raw)}catch{return fallback}
    },
    setJson(key,value){api.setItem(key,JSON.stringify(value))}
  };
  root.R5Storage=Object.freeze(api);
})(globalThis);
