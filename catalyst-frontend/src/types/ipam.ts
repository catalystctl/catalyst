/**
 * Represents an IP pool for automatic IPAM (IPv4 and IPv6 supported).
 */
export interface IpPool {
  id: string;
  nodeId: string;
  nodeName: string;
  networkName: string;
  /** CIDR notation, e.g. 192.168.50.0/24 or 2001:db8::/64 */
  cidr: string;
  /** Gateway IP — IPv4 or IPv6 */
  gateway?: string | null;
  /** Start of the assignment range — IPv4 or IPv6 */
  startIp?: string | null;
  /** End of the assignment range — IPv4 or IPv6 */
  endIp?: string | null;
  /** Reserved IPs — IPv4 or IPv6 */
  reserved?: string[];
  /** Computed start of the range */
  rangeStart: string;
  /** Computed end of the range */
  rangeEnd: string;
  total: number;
  reservedCount: number;
  usedCount: number;
  availableCount: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Payload to create a new IP pool (IPv4 and IPv6 supported).
 */
export interface CreateIpPoolPayload {
  nodeId: string;
  networkName: string;
  /** CIDR notation, e.g. 192.168.50.0/24 or 2001:db8::/64 */
  cidr: string;
  /** Gateway IP — IPv4 or IPv6 */
  gateway?: string;
  /** Start of the assignment range — IPv4 or IPv6 */
  startIp?: string;
  /** End of the assignment range — IPv4 or IPv6 */
  endIp?: string;
  /** Reserved IPs — IPv4 or IPv6 */
  reserved?: string[];
}
