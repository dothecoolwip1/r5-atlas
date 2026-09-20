/* R5 Atlas device-first IndexedDB storage. */
(function(root){
  'use strict';

  const DB_NAME='r5-atlas-device';
  const DB_VERSION=1;
  const SAVED_STORE='savedLocations';
  const META_STORE='meta';
  let openPromise=null;

  function requestResult(request){
    return new Promise((resolve,reject)=>{
      request.onsuccess=()=>resolve(request.result);
      request.onerror=()=>reject(request.error||new Error('IndexedDB request failed.'));
    });
  }

  function transactionDone(tx){
    return new Promise((resolve,reject)=>{
      tx.oncomplete=()=>resolve();
      tx.onabort=()=>reject(tx.error||new Error('IndexedDB transaction aborted.'));
      tx.onerror=()=>reject(tx.error||new Error('IndexedDB transaction failed.'));
    });
  }

  function open(){
    if(openPromise)return openPromise;
    if(!('indexedDB' in root))return Promise.reject(new Error('IndexedDB is not available in this browser.'));
    openPromise=new Promise((resolve,reject)=>{
      const request=root.indexedDB.open(DB_NAME,DB_VERSION);
      request.onupgradeneeded=()=>{
        const db=request.result;
        let saved;
        if(!db.objectStoreNames.contains(SAVED_STORE)){
          saved=db.createObjectStore(SAVED_STORE,{keyPath:'key'});
        }else{
          saved=request.transaction.objectStore(SAVED_STORE);
        }
        if(!saved.indexNames.contains('favorite'))saved.createIndex('favorite','favorite',{unique:false});
        if(!saved.indexNames.contains('lastVisitedAt'))saved.createIndex('lastVisitedAt','lastVisitedAt',{unique:false});
        if(!saved.indexNames.contains('visitCount'))saved.createIndex('visitCount','visitCount',{unique:false});
        if(!db.objectStoreNames.contains(META_STORE))db.createObjectStore(META_STORE,{keyPath:'key'});
      };
      request.onsuccess=()=>{
        const db=request.result;
        db.onversionchange=()=>db.close();
        resolve(db);
      };
      request.onerror=()=>{
        openPromise=null;
        reject(request.error||new Error('Could not open the R5 Atlas device database.'));
      };
      request.onblocked=()=>{
        openPromise=null;
        reject(new Error('The R5 Atlas device database is blocked by another tab.'));
      };
    });
    return openPromise;
  }

  async function getAllSavedLocations(){
    const db=await open();
    const tx=db.transaction(SAVED_STORE,'readonly');
    const request=tx.objectStore(SAVED_STORE).getAll();
    const result=await requestResult(request);
    await transactionDone(tx);
    return Array.isArray(result)?result:[];
  }

  async function getSavedLocation(key){
    const db=await open();
    const tx=db.transaction(SAVED_STORE,'readonly');
    const request=tx.objectStore(SAVED_STORE).get(key);
    const result=await requestResult(request);
    await transactionDone(tx);
    return result||null;
  }

  async function putSavedLocation(record){
    if(!record||!record.key)throw new Error('Saved location requires a canonical key.');
    const db=await open();
    const tx=db.transaction(SAVED_STORE,'readwrite');
    tx.objectStore(SAVED_STORE).put(record);
    await transactionDone(tx);
    return record;
  }

  async function putSavedLocations(records){
    const items=(records||[]).filter(record=>record&&record.key);
    if(!items.length)return [];
    const db=await open();
    const tx=db.transaction(SAVED_STORE,'readwrite');
    const store=tx.objectStore(SAVED_STORE);
    for(const record of items)store.put(record);
    await transactionDone(tx);
    return items;
  }

  async function deleteSavedLocation(key){
    const db=await open();
    const tx=db.transaction(SAVED_STORE,'readwrite');
    tx.objectStore(SAVED_STORE).delete(key);
    await transactionDone(tx);
  }

  async function clearSavedLocations(){
    const db=await open();
    const tx=db.transaction(SAVED_STORE,'readwrite');
    tx.objectStore(SAVED_STORE).clear();
    await transactionDone(tx);
  }

  async function getMeta(key,fallback=null){
    const db=await open();
    const tx=db.transaction(META_STORE,'readonly');
    const request=tx.objectStore(META_STORE).get(key);
    const result=await requestResult(request);
    await transactionDone(tx);
    return result&&Object.prototype.hasOwnProperty.call(result,'value')?result.value:fallback;
  }

  async function setMeta(key,value){
    const db=await open();
    const tx=db.transaction(META_STORE,'readwrite');
    tx.objectStore(META_STORE).put({key,value,updatedAt:new Date().toISOString()});
    await transactionDone(tx);
    return value;
  }

  async function countSavedLocations(){
    const db=await open();
    const tx=db.transaction(SAVED_STORE,'readonly');
    const request=tx.objectStore(SAVED_STORE).count();
    const count=await requestResult(request);
    await transactionDone(tx);
    return Number(count)||0;
  }

  root.R5DeviceStore=Object.freeze({
    dbName:DB_NAME,
    version:DB_VERSION,
    open,
    getAllSavedLocations,
    getSavedLocation,
    putSavedLocation,
    putSavedLocations,
    deleteSavedLocation,
    clearSavedLocations,
    getMeta,
    setMeta,
    countSavedLocations
  });
})(globalThis);
