import { request } from './requestUtils';
import { FinP2PHost } from './config';

export const createAsset = async (
  name: string,
  type: string,
  issuerId: string,
  verifiers: string[],
  denomination: Denomination,
  config: any,
  host: string = FinP2PHost) => {
  return request({
    type: 'post',
    url: '/finapi/profiles/asset',
    data: {
      name,
      type,
      verifiers,
      config,
      issuerId,
      denomination,
    },
    host,
  }).then((value: any) => {
    const val = value as ProfileOperation;
    if (val.error !== undefined || val.response === undefined) {
      throw Error('got error or missing response');
    }
    return { id: val.response.id };
  }) as { [key: string]: any };
};

export interface Denomination {
  type: string;
  code: string;
}

export interface ProfileOperation extends Operation {
  error?: any;
  response?: IdResponse;
}

export interface Operation {
  cid: string;
  isCompleted: boolean;
}
export interface IdResponse {
  id: string;
}