const { Buffer } = require('buffer');
const { parse }       = require('querystring');
const { get, success } = require('./index');

exports.handler = async (event /*, context */) => {
  const { path, method } = event.requestContext.http;
  let response;
  if (path.startsWith('/payMyTuition/dataReturn') && method == 'POST') {
    response = showSuccess(event);
  // } else if (path.startsWith('/payMyTuition/success') && method == 'GET') {
  //   response = showSuccess(event);
  } else if (path.startsWith('/payMyTuition/error')) {
    console.error("An error has occurred in the Pay My Tution process");
    return { statusCode: 400, body: 'An error has occurred in the Pay My Tution processing.' };
  } else if (path.startsWith('/payMyTuition') && method == 'GET') {
    response = connector(event);
  }
  return response;
};

const connector = async (event) => {
  const path = event.stageVariables?.CustomDomainPath + event.requestContext.http.path;
  const returnUrl = `${event.headers['x-forwarded-proto']}://${event.headers.host}${path}`.replace(/\/$/, "");
  const referrer = event.queryStringParameters?.returnUrl || event.headers['referer'];

  try {
    const resp = await get(event.queryStringParameters, returnUrl, referrer);
    return { 
      statusCode: 200, 
      headers: { 'Content-type': 'text/html' },
      body: resp
    };
  } catch(e) {
    return { statusCode: 400, body: e.message };
  }
}

const showSuccess = async (event) => {
  const body = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString() : event.body;
  try {
    const resp = await success(parse(body));
    return { 
      statusCode: 200, 
      headers: { 'Content-type': 'text/html' },
      body: resp
    }    
  } catch(e) {
    return  { statusCode: 400, body: e.message };
  }
}

