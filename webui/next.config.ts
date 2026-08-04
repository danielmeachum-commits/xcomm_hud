import type { NextConfig } from 'next';
import { withDomscribe } from '@domscribe/next';

const nextConfig: NextConfig = {};

// Pin the relay port. Left dynamic, every relay restart lands on a new port and
// the MCP server — which caches the port when it connects — is stranded on the
// old one until you reconnect it. 4400 is clear of the ports this stack uses
// (3001 webui, 5433 postgres, 8001 api, 9000/9001 minio).
export default withDomscribe({
  relay: { port: 4400 },
})(nextConfig);