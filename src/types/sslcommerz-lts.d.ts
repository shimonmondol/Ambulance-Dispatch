declare module "sslcommerz-lts" {
  export default class SSLCommerzPayment {
    constructor(store_id: string, store_passwd: string, is_live: boolean);
    init(data: Record<string, any>): Promise<{
      status?: string;
      failedreason?: string;
      sessionkey?: string;
      GatewayPageURL?: string;
      [key: string]: any;
    }>;
    validate(data: Record<string, any>): Promise<any>;
    transactionQueryBySessionId(data: Record<string, any>): Promise<any>;
    transactionQueryByTransactionId(data: Record<string, any>): Promise<any>;
  }
}