import type { LoginTransaction } from "../domain/types.js";

export interface LoginTransactionStore {
  /** 按 owner namespace 原子地创建事务；同一 owner 下 transactionId 已存在时返回 false。 */
  create(transaction: LoginTransaction): Promise<boolean>;
  /** 按 owner namespace 原子地读取并删除事务；不存在或过期时返回 null。 */
  consume(ownerNamespace: string, transactionId: string): Promise<LoginTransaction | null>;
  close?(): Promise<void> | void;
}
