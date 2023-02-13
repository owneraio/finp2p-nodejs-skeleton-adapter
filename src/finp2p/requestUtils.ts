import * as axios from 'axios';
import { generateAuthorizationHeader } from './auth';


const handleErrors = (error: any) => {
  let errorMsg = '';
  if (error.response) {
    const { status, data } = error.response;
    if (status === 422) {
      errorMsg = data.errors.reduce((msg: string, err: any) => msg.concat(`${err.msg}, `), '');
    } else {
      if (data) {
        if (data.error) {
          errorMsg = data.error.message;
        } else if (data.message) {
          errorMsg = data.message;
        } else {
          errorMsg = data;
        }
      }
    }
  } else if (error.request) {
    errorMsg = error.request;
  } else {
    errorMsg = error.message;
  }

  return errorMsg;
};

export const request = ({ type, data, headers, url, host }: { type: string, data?: any, headers?: any, url: string, host?: string }): { [key: string]: any } =>
  new Promise((resolve, reject) => {
    const baseUri = `http://${host}`;
    // @ts-ignore
    axios[type](baseUri + url, data, {
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...headers,
      },
    }).then((response: any) => {
      resolve(response.data);
    }).catch((error: any) => {
      console.log('error', error);
      const errorMsg = handleErrors(error);
      reject(errorMsg);
    });
  });

const extractOrganizationNameFromURL = ({ url }: { url: string }) => {
  let startIndex = url.indexOf('://');
  if (startIndex === -1) {
    console.log('unable to extract organization name from url, unexpected url structure');
    return '';
  } else {
    startIndex += 3;
  }
  let endIndex = url.indexOf('.');
  if (endIndex === -1) {
    console.log('unable to extract organization name from url, unexpected url structure');
    return '';
  }
  return url.substring(startIndex, endIndex);
};

axios.default.interceptors.request.use((config) => {
  const headerValue = generateAuthorizationHeader({ organization: extractOrganizationNameFromURL({ url: config.url || '' }) });
  config.headers.Authorization = `Bearer ${headerValue}`;
  return config;
});
