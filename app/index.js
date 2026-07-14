const express = require('express');
const jwt     = require('jsonwebtoken');
const escapeHtml = require('escape-html');
const PayMyTuition = require('./payMyTuition');
const responses = require('./responses');
const { frombase64 } = require('./utils');
const { getFees, payFees } = require('./alma');
const fs = require('fs');
const process = require('process');

const http = require('http');
const https = require('https');
const library = process.env.ALMA_LIBRARY_CODE;
let privateKey, certificate, credentials;
if (process.env.CERTIFICATE_KEY_FILE) {
  privateKey  = fs.readFileSync(process.env.CERTIFICATE_KEY_FILE, 'utf8');
  certificate = fs.readFileSync(process.env.CERTIFICATE_CRT_FILE, 'utf8');
  credentials = {key: privateKey, cert: certificate};
}

const HTTPS_ONLY = !!process.env.HTTPS_ONLY;
if (HTTPS_ONLY && !credentials) {
  console.error('HTTPS_ONLY is set but no certificate files are provided. Exiting.');
  process.exit(1);
}

console.log('Starting PayMyTuition connector');

let payMyTuition;
const init = async (payMyTuition_url) => {
  if (!payMyTuition) {
    console.log('Initializing PayMyTuition');
    payMyTuition = await PayMyTuition.init(payMyTuition_url || process.env.PAY_MY_TUITION_URL);
  }
}

const PORT = process.env.PORT || 3002;
const SECURE_PORT = process.env.SECURE_PORT || 3003;
const app = express();
app.use(express.urlencoded({extended: true}));
app.use(express.json({
  verify: (req, res, buf) => { req.rawBody = buf.toString('utf8'); }
}));

app.get('/', (request, response) => {
  response.send('PayMyTuition connector');
})

app.get('/payMyTuition', async (request, response) => {
  const protocol = request.get('x-forwarded-proto') || request.protocol;
  const host = request.get('x-forwarded-host') || request.get('host');
  const returnUrl = (protocol + '://' + host + request.originalUrl.split("?").shift()).replace(/\/$/, "");
  const referrer = request.query.returnUrl || request.header('Referer');

  if (referrer && typeof referrer !== 'string') {
    return response.status(400).send('Malformed returnUrl');
  }

  try {
    const resp = await get(request.query, returnUrl, referrer);
    // response.send(resp);
    response.redirect(302, resp);
  } catch (e) {
    return response.status(400).send(escapeHtml(e.message));
  }
})

const get = async (qs, returnUrl, referrer) => {
  // if (!qs || !returnUrl) return 'PayMyTuition connector';
  let user_id, total_sum, pmt_ext_inst_ref, post_message = 'false', institution, payMyTuition_url;

  if (qs.s) {
    /* From CloudApp */
    ({ user_id, total_sum } = JSON.parse(frombase64(qs.s)));
    post_message = 'true';
  } else if (qs.jwt) {
    /* From Primo VE */
    // The JWT is decoded but not signature-verified. It carries the patron's
    // user ID as a convenience from Primo — it is not used as an auth
    // credential. Requiring operators to configure a public key would
    // add setup complexity with no meaningful security benefit.
    try {      
      ({ userName: user_id, institution } = jwt.decode(qs.jwt));
    } catch (e) {
      console.error("Error in retrieving user information:", e.message)
      throw new Error('Cannot retrieve user details information.');
    }
  } else if (qs.pds_handle) {
    /* From Primo Classic */
    try {
      const ref = new URL(referrer);
      // Validate that the referrer is using HTTPS.
      if (ref.protocol !== 'https:') {
        throw new Error('Insecure referrer');
      }
      // Validate that the referrer host is in an expected format sufficient to
      // prevent shenanigans.
      const validHostnamePattern = /^(?!-)[A-Za-z0-9-]{1,63}(?<!-)(\.[A-Za-z0-9-]{1,63})*\.?(:\d{1,5})?$/;
      if (!ref.host || !validHostnamePattern.test(ref.host)) {
        throw new Error('Invalid referrer host');
      }
      // Validate institution code.
      // Primo institution codes can only contain uppercase letters.
      if (!qs.institution || /[^A-Z]/.test(qs.institution)) {
        throw new Error('Missing or invalid institution code');
      }
      // Validate pds_handle.
      // Primo pds_handles can only contain digits.
      if (/[^0-9]/.test(qs.pds_handle)) {
        throw new Error('Invalid pds_handle');
      }
      const url = `https://${ref.host}/primo_library/libweb/webservices/rest/PDSUserInfo?institute=${qs.institution}&pds_handle=${qs.pds_handle}`;
      console.log('retrieving borinfo from', url);
      const response = await fetch(url);
      const borinfo = await response.text();
      const node = require('xpath').select('/bor/bor_id/id', new dom().parseFromString(borinfo));
      user_id = node.length > 0 ? node[0].firstChild.data : null;
    } catch (e) {
      console.error("Error in retrieving user information:", e.message)
      throw new Error('Cannot retrieve user details information.');
    }
  }
// console.log(user_id)
  ({ total_sum } = await getFees(user_id, library));
  // if (!user_id || total_sum <= 0) throw new Error('Nothing to pay');
// total_sum = 100;
// user_id = 'TEST';
// institution = 'testInst';
// returnUrl = 'bhiebert.3utilities.com'
// console.log(total_sum);
  await init(payMyTuition_url);

  // const ticketName = `${user_id}|${referrer}|${post_message}`;
  // const ticketName = `${user_id}|${post_message}`;
  const ticketName = user_id + "_" + Date.now();
console.log(ticketName);  
  try {
    let personalRedirectUrl = await payMyTuition.retrievePaymentUrl(ticketName, {
      user_id: user_id,
      amount: total_sum,
      // success: referrer,
      dataReturn: returnUrl + '/payMyTuition/dataReturn',
      error: returnUrl + '/payMyTuition/error',
      cancel: returnUrl + '/payMyTuition/error',
      referrer: referrer,
      // post_message: post_message,
      institution: institution
    });
    console.log('Successfully received redirect URL ', personalRedirectUrl);
    return personalRedirectUrl
    // return responses.redirectUser(personalRedirectUrl);
  } catch (e) {
    console.error("Error in setting up payment:", e.message)
    throw new Error('Cannot prepare payment information.');
  }
}

app.post('/payMyTuition/dataReturn', async(request, response) => {
  try {
    const resp = await dataReturn(request.headers, request.body, request.rawBody);
    response.send(resp);
  } catch(e) {
    return response.status(400).send(escapeHtml(e.message));
  }
})

const dataReturn = async (headers, body, rawBody) => {
  await init();

  let receipt, user_id, referrer, post_message;
  try {
    ({ receipt, user_id, amount } = payMyTuition.authorize(headers['authorization'], headers['x_date'], body, rawBody));
    // ({ receipt, user_id, referrer, post_message, amount } = payMyTuition.authorize(header('authorization'), header('X_DATE'), body));
  } catch(e) {
    console.error("Error while authorizing payment:", e.message);
    throw new Error('Could not authorize payment.')
  }
  
  try {
    if (post_message === 'true') {
      // return responses.returnToReferrer(referrer, { amount: amount, external_transaction_id: receipt, user_id: user_id });
    } else {    
      await payFees(user_id, amount, receipt, library);
      console.log('Payment posted to Alma. Returning to referrer', referrer);
      // return responses.returnToReferrer(referrer);
    }
  } catch (e) {
    console.error("Error in posting payment to Alma:", e.message);
    throw new Error('Could not post payment to Alma')
  }
}

app.get('/payMyTuition/error', (request, response) => {
  response.status(400).send('An error has occurred');
})

if (!HTTPS_ONLY) http.createServer(app).listen(PORT);
if (credentials) https.createServer(credentials, app).listen(SECURE_PORT);

module.exports = { get, dataReturn };
