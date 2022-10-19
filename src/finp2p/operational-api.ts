import axios from 'axios';

const post = (url: string, data: any, host: string) =>
  new Promise((resolve, reject) => {
    axios.post(`${host}${url}`, data, {
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    }).then(({ data: response }) => {
      resolve(response);
    }).catch((error: Error) => {
      console.log('error', error);
      reject(error.message);
    });
  });

export class OperationalAPI {

  public static async importTransactions(req: Paths.ImportTransactions.RequestBody): Promise<Paths.ImportTransactions.Responses.$200> {
    const host = process.env.FINP2P_NODE_HOST || '';
    return await post('/ledger/transaction/import', req, host) as Paths.Payout.Responses.$200;
  }
}
