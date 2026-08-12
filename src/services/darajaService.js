const SANDBOX_AUTH_URL = 'https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials';
const LIVE_AUTH_URL = 'https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials';
const SANDBOX_STK_URL = 'https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest';
const LIVE_STK_URL = 'https://api.safaricom.co.ke/mpesa/stkpush/v1/processrequest';
const SANDBOX_QUERY_URL = 'https://sandbox.safaricom.co.ke/mpesa/stkpushquery/v1/query';
const LIVE_QUERY_URL = 'https://api.safaricom.co.ke/mpesa/stkpushquery/v1/query';

function normalizeMode(mode){ const m=String(mode||'sandbox').toLowerCase(); return (m==='live'||m==='production') ? 'live' : 'sandbox'; }
function urlsForMode(mode){ const sandbox=normalizeMode(mode)!=='live'; return { authUrl:sandbox?SANDBOX_AUTH_URL:LIVE_AUTH_URL, stkUrl:sandbox?SANDBOX_STK_URL:LIVE_STK_URL, queryUrl:sandbox?SANDBOX_QUERY_URL:LIVE_QUERY_URL }; }
function getEnv(overrides = {}){
  const mode = normalizeMode(overrides.mode || overrides.environment || process.env.DARAJA_ENV || process.env.MPESA_ENV || 'sandbox');
  const urls = urlsForMode(mode);
  const shortcode = overrides.shortcode || overrides.businessShortCode || overrides.businessShortcode || process.env.DARAJA_SHORTCODE || process.env.MPESA_SHORTCODE;
  return {
    mode,
    consumerKey: overrides.consumerKey || overrides.darajaConsumerKey || process.env.DARAJA_CONSUMER_KEY || process.env.MPESA_CONSUMER_KEY,
    consumerSecret: overrides.consumerSecret || overrides.darajaConsumerSecret || process.env.DARAJA_CONSUMER_SECRET || process.env.MPESA_CONSUMER_SECRET,
    shortcode,
    passkey: overrides.passkey || overrides.darajaPasskey || process.env.DARAJA_PASSKEY || process.env.MPESA_PASSKEY,
    transactionType: overrides.transactionType || process.env.DARAJA_TRANSACTION_TYPE || 'CustomerPayBillOnline',
    callbackUrl: overrides.callbackUrl || process.env.DARAJA_CALLBACK_URL || process.env.MPESA_CALLBACK_URL,
    authUrl: overrides.authUrl || process.env.DARAJA_AUTH_URL || urls.authUrl,
    stkUrl: overrides.stkUrl || process.env.DARAJA_STK_PUSH_URL || urls.stkUrl,
    queryUrl: overrides.queryUrl || process.env.DARAJA_STK_QUERY_URL || urls.queryUrl
  };
}
function formatPhone(phone){ let p=String(phone||'').replace(/\D/g,''); if(p.startsWith('0')) p='254'+p.slice(1); if(p.startsWith('7')||p.startsWith('1')) p='254'+p; if(!/^254(7|1)\d{8}$/.test(p)) throw new Error('Use a valid Safaricom phone number like 254708374149'); return p; }
function timestamp(){ const d=new Date(); const pad=n=>String(n).padStart(2,'0'); return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`; }
function validateCfg(cfg){ const missing=[]; ['consumerKey','consumerSecret','shortcode','passkey','callbackUrl'].forEach(k=>{ if(!cfg[k]) missing.push(k); }); if(missing.length) throw new Error(`Daraja configuration missing: ${missing.join(', ')}`); }
async function getAccessToken(overrides = {}){ const cfg=getEnv(overrides); validateCfg({...cfg, callbackUrl:'ok'}); const auth=Buffer.from(`${cfg.consumerKey}:${cfg.consumerSecret}`).toString('base64'); const response=await fetch(cfg.authUrl,{headers:{Authorization:`Basic ${auth}`}}); const text=await response.text(); let json; try{json=JSON.parse(text);}catch{json={raw:text};} if(!response.ok||!json.access_token) throw new Error(`Daraja token request failed: ${json.errorMessage||json.error||text}`); return json.access_token; }
function buildPassword(shortcode, passkey, ts){ return Buffer.from(`${shortcode}${passkey}${ts}`).toString('base64'); }
async function initiateSTKPush({ phone, amount, accountReference, transactionDesc, callbackUrl, metadata={}, credentials={} }){ const cfg=getEnv(credentials); validateCfg({...cfg, callbackUrl:callbackUrl||cfg.callbackUrl}); const normalizedPhone=formatPhone(phone); const normalizedAmount=Math.max(1,Math.round(Number(amount||0))); if(!normalizedAmount) throw new Error('Payment amount must be at least 1'); const ts=timestamp(); const token=await getAccessToken(credentials); const payload={ BusinessShortCode:cfg.shortcode, Password:buildPassword(cfg.shortcode,cfg.passkey,ts), Timestamp:ts, TransactionType:cfg.transactionType, Amount:normalizedAmount, PartyA:normalizedPhone, PartyB:cfg.shortcode, PhoneNumber:normalizedPhone, CallBackURL:callbackUrl||cfg.callbackUrl, AccountReference:String(accountReference||'SHULEAI').slice(0,12), TransactionDesc:String(transactionDesc||'Shule AI payment').slice(0,100) }; const response=await fetch(cfg.stkUrl,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(payload)}); const text=await response.text(); let json; try{json=JSON.parse(text);}catch{json={raw:text};} if(!response.ok||json.errorCode){ const msg=json.errorMessage||json.ResponseDescription||json.raw||text; throw new Error(`Daraja STK Push failed: ${msg}`); } return {...json,environment:cfg.mode,requestPayload:{...payload,Password:'[hidden]'},metadata}; }
async function querySTKStatus(checkoutRequestId, overrides = {}){ const cfg=getEnv(overrides); validateCfg(cfg); if(!checkoutRequestId) throw new Error('CheckoutRequestID is required'); const ts=timestamp(); const token=await getAccessToken(overrides); const payload={ BusinessShortCode:cfg.shortcode, Password:buildPassword(cfg.shortcode,cfg.passkey,ts), Timestamp:ts, CheckoutRequestID:checkoutRequestId }; const response=await fetch(cfg.queryUrl,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(payload)}); return response.json().catch(()=>({})); }
function parseCallback(body){ const stk=body?.Body?.stkCallback||body?.stkCallback||body; const items=stk?.CallbackMetadata?.Item||[]; const find=name=>items.find(i=>i.Name===name)?.Value; return { merchantRequestId:stk?.MerchantRequestID, checkoutRequestId:stk?.CheckoutRequestID, resultCode:stk?.ResultCode, resultDesc:stk?.ResultDesc, amount:find('Amount'), mpesaReceiptNumber:find('MpesaReceiptNumber'), transactionDate:find('TransactionDate'), phoneNumber:find('PhoneNumber'), raw:body }; }
module.exports={getEnv,formatPhone,initiateSTKPush,querySTKStatus,parseCallback,getAccessToken};
