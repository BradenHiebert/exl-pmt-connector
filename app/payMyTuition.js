const process    = require('process');
const crypto     = require('crypto');

class PayMyTuition {
  static async init(uri) {
    const o = new PayMyTuition();
    await o._init(uri);
    return o;
  }

  async _init(uri) {
    // Validate PMT configs are in process.env
    if (!process.env.PMT_URL 
    || !process.env.PMT_TRAN_KEY
    || !process.env.PMT_LOGIN_KEY
    || !process.env.PMT_SECRET_KEY      
    || !process.env.PMT_EXT_INST_REF
    || !process.env.PMT_PMNT_DEST
    || !process.env.PMT_PRIMO_PMNT_TYPE) {
      throw new Error('Missing required Pay My Tuition settings');
    }
    this.uri = process.env.PMT_URL;
    this.auth = process.env.PMT_SECRET_KEY;
    this.login = process.env.PMT_LOGIN_KEY;
    this.trnKey = process.env.PMT_TRAN_KEY;
  }

  async retrievePaymentUrl(ticketName, options) {
    let body = generatePreloadBody(ticketName, options)
    let returnJson = await pmtRequest(this.uri, this.login, this.trnKey, this.auth, body);
    if(!returnJson.isSucceeded || returnJson.isSucceeded == "false") {
      throw new Error('Preload request failed');
    }
    return returnJson.data.url;
  }

  authorize(authorization, xDate, jsonBody, rawBody) {
    if(!authorization) {
      throw new Error('Missing authorization header');
    } else if (!xDate) {
      throw new Error('Missing X_DATE header');
    }

    const remoteSignature = authorization.slice(authorization.indexOf(":") + 2);
    const localSignature = calculateSignature(this.login, xDate, this.auth, rawBody);
    if(remoteSignature !== localSignature) {
      throw new Error('Invalid Signature');
    }

    const [user_id, referrer, post_message] = jsonBody.OrderId.split("|");
    return { 
      receipt:  jsonBody.TransactionId,
      user_id:  user_id,
      referrer: referrer,
      post_message: post_message,
      amount: jsonBody.PaymentAmount
    }
  }
}

const pmtRequest = async (uri, login, trnKey, auth, requestBody) => {
  const xDate = new Date().toISOString();
  let signature = calculateSignature(login, xDate, auth, requestBody)
  let request = {
    method: 'POST',
    headers: new Headers({
      'Content-Type':'application/json',
      'Authorization': "V2-HMAC-SHA256, Signature: " + signature,
      'X_DATE': xDate,
      'X_LOGIN': login,
      'X_TRANS_KEY': trnKey
    }),
    body: requestBody
  };

  const response = await fetch(uri, request);
  if (!response.ok) {
    throw new Error('Network request failed');
  }
  return await response.json();
}

const calculateSignature = function(xLogin, date, key, body = '') {
    const toSign = xLogin + body + date;
    const signatureHex = crypto
        .createHmac('sha256', key)
        .update(toSign, 'utf8')
        .digest('hex');
    return signatureHex;
}

const generatePreloadBody = (ticketName, options) => {
  //Note: Check of ticketName for potentially malicious characters removed b/c it is no longer injected into a script and thus is no longer a potential attack vector for an XSS attack.  
  const payload = {
      OrderId: ticketName,
      MerchantName: options.institution,
      PaymentType: process.env.PMT_PRIMO_PMNT_TYPE,
      ExternalInstituteRef: process.env.PMT_EXT_INST_REF,
      PaymentDestination: process.env.PMT_PMNT_DEST,
      StudentID: options.user_id,
      // SuccessCallBckURL: `${options.success}?institution=${encodeURIComponent(options.institution)}&referrer=${encodeURIComponent(options.referrer)}`,
      SuccessCallBckURL: options.referrer,
      CancelCallBckURL: options.cancel,
      ErrorCallBckURL: options.error,
      DataCallBckURL: `${options.dataReturn}`,//?institution=${encodeURIComponent(options.institution)}`,
      PaymentRequestObj: { PaymentAmount: options.amount }
  };

  return JSON.stringify(payload);
}

module.exports = PayMyTuition;
