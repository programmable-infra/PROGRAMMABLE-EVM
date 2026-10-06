export function createReadOnlyRpc(upstream: string, options?: {
  maximumRequests?: number;
  fetchImpl?: typeof fetch;
}): {
  request<T = unknown>(method: string, params?: readonly unknown[]): Promise<T>;
  listen(): Promise<{ url: string; close(): Promise<void> }>;
  statistics(): { requests: number; maximumRequests: number; methods: Record<string, number>; denied: Record<string, number> };
};
