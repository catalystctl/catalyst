declare function hashPassword(password: string): Promise<string>;
declare function verifyPassword(hash: string, password: string): Promise<boolean>;

export { hashPassword, verifyPassword };
